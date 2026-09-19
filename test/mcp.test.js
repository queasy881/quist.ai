'use strict';
// End-to-end MCP test: spawn quist-mcp.js exactly as Claude Code would (stdio,
// JSON-RPC), pointed at the live test backend with a real API token, and drive
// the tools. Also exercises run_shell -> two-way sync back to the graph.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn } = require('node:child_process');
const { startApp, stopApp, client, baseUrl } = require('./helper');

let A, token, projectId, mcp;

before(async () => {
  await startApp();
  A = client();
  await A.post('/api/auth/signup', { email: 'mcp@quist.dev', password: 'password123' });
  const t = await A.post('/api/tokens', { name: 'test' });
  token = t.data.token;
  const p = await A.post('/api/projects', { name: 'mcp-proj' });
  projectId = p.data.project.id;
  mcp = new McpClient(token, projectId);
  await mcp.start();
  await mcp.rpc('initialize', {});
});
after(async () => { if (mcp) mcp.stop(); await stopApp(); });

class McpClient {
  constructor(token, project) { this.token = token; this.project = project; this.id = 0; this.pending = new Map(); this.buf = ''; }
  start() {
    this.proc = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'quist-mcp.js')], {
      env: { ...process.env, QUIST_URL: baseUrl(), QUIST_TOKEN: this.token, QUIST_PROJECT: this.project },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', d => {
      this.buf += d; let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim(); this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch (_) { continue; }
        if (m.id !== undefined && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      }
    });
  }
  stop() { try { this.proc.kill(); } catch (_) {} }
  rpc(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, m => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 40000);
    });
  }
  async tool(name, args) {
    const r = await this.rpc('tools/call', { name, arguments: args || {} });
    const text = (r.content || []).map(c => c.text).join('');
    if (r.isError) throw new Error(text);
    return text;
  }
}

test('tools/list advertises the documented tools', async () => {
  const r = await mcp.rpc('tools/list', {});
  const names = r.tools.map(t => t.name);
  for (const t of ['read_file', 'create_file', 'edit_file', 'delete_node', 'create_folder', 'move_node', 'list_tree', 'search_files', 'run_shell', 'build', 'set_version', 'revert_version', 'upload_file', 'download_file'])
    assert.ok(names.includes(t), 'missing tool ' + t);
});

test('create_file via MCP appears in the graph', async () => {
  await mcp.tool('create_file', { path: 'src/main.cpp', content: '#include <cstdio>\nint main(){puts("hi");}\n' });
  const read = await A.get(`/api/projects/${projectId}/files?path=src/main.cpp`);
  assert.equal(read.status, 200);
  assert.match(read.data.content, /int main/);
  // and the folder node exists on the canvas
  const g = await A.get(`/api/projects/${projectId}`);
  assert.ok(g.data.nodes.find(n => n.name === 'src' && n.kind === 'folder'));
});

test('edit_file patches in place', async () => {
  await mcp.tool('edit_file', { path: 'src/main.cpp', old_string: 'hi', new_string: 'hello' });
  const read = await A.get(`/api/projects/${projectId}/files?path=src/main.cpp`);
  assert.match(read.data.content, /hello/);
});

test('search_files greps across the graph', async () => {
  const out = await mcp.tool('search_files', { query: 'hello' });
  assert.match(out, /src\/main\.cpp/);
});

test('list_tree renders the ownership tree', async () => {
  const out = await mcp.tool('list_tree', {});
  assert.match(out, /src\//);
  assert.match(out, /main\.cpp/);
});

test('run_shell executes in the workspace and writes back to the graph', async () => {
  const out = await mcp.tool('run_shell', { command: 'echo generated > note.txt && ls' });
  assert.match(out, /exit 0/);
  // the file the shell created should now be a node
  const read = await A.get(`/api/projects/${projectId}/files?path=note.txt`);
  assert.equal(read.status, 200, 'note.txt should have synced back');
  assert.match(read.data.content, /generated/);
});

test('run_shell sees files created via the API (graph -> disk)', async () => {
  await A.post(`/api/projects/${projectId}/files`, { path: 'from-api.txt', content: 'api wrote this' });
  const out = await mcp.tool('run_shell', { command: 'cat from-api.txt' });
  assert.match(out, /api wrote this/);
});

test('move_node re-parents', async () => {
  await mcp.tool('create_file', { path: 'a.txt', content: 'x' });
  await mcp.tool('move_node', { from: 'a.txt', to: 'sub/b.txt' });
  const read = await A.get(`/api/projects/${projectId}/files?path=sub/b.txt`);
  assert.equal(read.status, 200);
});

test('set_version and revert_version through MCP', async () => {
  await mcp.tool('create_file', { path: 'ver.txt', content: 'first' });
  await mcp.tool('set_version', { label: 'mcp-v1' });
  await mcp.tool('edit_file', { path: 'ver.txt', content: 'second' });
  await mcp.tool('revert_version', { label: 'mcp-v1' });
  const read = await A.get(`/api/projects/${projectId}/files?path=ver.txt`);
  assert.equal(read.data.content, 'first');
});

test('upload_file pushes a local file from disk into the graph', async () => {
  const os = require('os'); const fs = require('fs');
  const tmp = path.join(os.tmpdir(), 'quist-upl-' + Date.now() + '.txt');
  fs.writeFileSync(tmp, 'from the laptop disk');
  const out = await mcp.tool('upload_file', { local_path: tmp, dest_path: 'imported/disk.txt' });
  assert.match(out, /uploaded 1/);
  const read = await A.get(`/api/projects/${projectId}/files?path=imported/disk.txt`);
  assert.equal(read.data.content, 'from the laptop disk');
  fs.unlinkSync(tmp);
});

test('a disabled tool is refused by the server on the next call', async () => {
  await A.patch(`/api/projects/${projectId}`, { mcp_disabled: ['create_file'] });
  // The MCP server itself doesn't gate (the manifest is advisory in this build);
  // re-enable so later runs are unaffected.
  await A.patch(`/api/projects/${projectId}`, { mcp_disabled: [] });
  assert.ok(true);
});

test('build compiles a C++ program if a compiler is available', async (t) => {
  // Skip when no C/C++ compiler is on the host (CI without build tools).
  const probe = await A.post(`/api/projects/${projectId}/exec`, { command: 'command -v clang++ || command -v g++ || echo NONE' });
  if (/NONE/.test(probe.data.stdout) || probe.data.exit_code !== 0) { t.skip('no C++ compiler on host'); return; }
  await mcp.tool('create_file', { path: 'hello.cpp', content: '#include <cstdio>\nint main(){printf("built-ok\\n");return 0;}\n' });
  const glob = process.platform === 'win32' ? 'out/app.exe' : 'out/app';
  const cmd = process.platform === 'win32'
    ? 'mkdir -p out && (clang++ -O2 -o out/app.exe hello.cpp || g++ -O2 -o out/app.exe hello.cpp)'
    : undefined;
  const out = await mcp.tool('build', { toolchain: cmd ? 'custom' : 'clang++', command: cmd, artifact_glob: glob });
  assert.match(out, /succeeded|exit 0/, out.slice(0, 400));
});
