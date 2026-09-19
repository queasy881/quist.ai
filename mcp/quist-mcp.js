#!/usr/bin/env node
'use strict';
/*
 * quist-mcp.js — the Quist MCP server.
 *
 * Runs on YOUR laptop, spawned by Claude Code over stdio. It never touches the
 * local disk except when you explicitly ask it to (upload_file / download_file).
 * Every file operation is an HTTPS call to your Quist backend, authenticated
 * with a per-user token, so the multi-gigabyte project lives on the server and
 * the same workspace is there from any machine.
 *
 * Zero dependencies — just Node >= 18 (uses global fetch). No build step.
 *
 * Configure via env (usually in .mcp.json):
 *   QUIST_URL       https://your-app.up.railway.app   (required)
 *   QUIST_TOKEN     qst_...                            (required; make it in the MCP tab)
 *   QUIST_PROJECT   <project id>                       (optional; else use list_projects/use_project)
 *
 * Speaks MCP over stdio (JSON-RPC 2.0, protocol 2024-11-05).
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const BASE = (process.env.QUIST_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.QUIST_TOKEN || '';
let PROJECT = process.env.QUIST_PROJECT || '';
const PROTO = '2024-11-05';
const MAX_UPLOAD = 200 * 1024 * 1024;

function fail(msg) { process.stderr.write('[quist-mcp] ' + msg + '\n'); }
if (!BASE) fail('QUIST_URL is not set — the server will report configuration errors on every call.');
if (!TOKEN) fail('QUIST_TOKEN is not set — generate one in the MCP tab and put it in .mcp.json.');

// ---- HTTP to the backend ----
async function call(method, apiPath, { body, raw, query } = {}) {
  if (!BASE || !TOKEN) throw new Error('quist-mcp is not configured: set QUIST_URL and QUIST_TOKEN');
  let url = BASE + apiPath;
  if (query) { const qs = new URLSearchParams(query).toString(); if (qs) url += '?' + qs; }
  const headers = { Authorization: 'Bearer ' + TOKEN };
  const init = { method, headers };
  if (body instanceof Buffer || body instanceof Uint8Array) init.body = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await fetch(url, init);
  if (raw) { if (!r.ok) throw new Error(await errText(r)); return Buffer.from(await r.arrayBuffer()); }
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { error: text }; }
  if (!r.ok) throw new Error(json.error || (r.status + ' ' + r.statusText));
  return json;
}
async function errText(r) { try { const j = await r.json(); return j.error || r.statusText; } catch (_) { return r.status + ' ' + r.statusText; } }
function needProject() { if (!PROJECT) throw new Error('no project selected — call list_projects then use_project, or set QUIST_PROJECT'); return PROJECT; }
const P = () => '/api/projects/' + needProject();

// ---- tool implementations ----
const impl = {
  async list_projects() {
    const { projects } = await call('GET', '/api/projects');
    const cur = PROJECT;
    return projects.map(p => `${p.id === cur ? '* ' : '  '}${p.id}  ${p.name}  (${p.nodes} nodes)`).join('\n') || '(no projects yet — create one in the web UI)';
  },
  async use_project({ project_id, name }) {
    const { projects } = await call('GET', '/api/projects');
    const p = projects.find(x => x.id === project_id || x.name === name || x.name === project_id);
    if (!p) throw new Error('no such project: ' + (project_id || name));
    PROJECT = p.id;
    return `selected ${p.name} (${p.id})`;
  },
  async list_tree({ path: sub, depth }) {
    const { tree } = await call('GET', P() + '/tree', { query: clean({ path: sub, depth, text: 1 }) });
    return renderTree(tree);
  },
  async read_file({ path: p }) {
    const r = await call('GET', P() + '/files', { query: { path: p } });
    if (r.binary) return `[binary file, ${r.size} bytes — use download_file to fetch it]`;
    return r.content;
  },
  async read_files({ paths }) {
    if (!Array.isArray(paths) || !paths.length) throw new Error('paths must be a non-empty array');
    const { files, missing } = await call('POST', P() + '/files/batch', { body: { paths } });
    const parts = files.map(f => `===== ${f.path} =====\n${f.binary ? '[binary, ' + f.size + ' bytes]' : f.content}`);
    if (missing.length) parts.push('===== missing =====\n' + missing.join('\n'));
    return parts.join('\n\n');
  },
  async create_file({ path: p, content }) {
    const r = await call('POST', P() + '/files', { body: { path: p, content: content == null ? '' : String(content), overwrite: true } });
    return `${r.created ? 'created' : 'wrote'} ${r.path}`;
  },
  async edit_file({ path: p, old_string, new_string, replace_all, content }) {
    if (content !== undefined && old_string === undefined) {
      await call('POST', P() + '/files/edit', { body: { path: p, content: String(content) } });
      return `wrote ${p} (full replace)`;
    }
    const r = await call('POST', P() + '/files/edit', { body: { path: p, old_string, new_string, replace_all: !!replace_all } });
    return `edited ${p} (${r.replaced} replacement${r.replaced === 1 ? '' : 's'})`;
  },
  async create_folder({ path: p }) {
    const r = await call('POST', P() + '/folders', { body: { path: p } });
    return `${r.created ? 'created folder' : 'folder exists'} ${p}`;
  },
  async move_node({ from, to }) {
    const r = await call('POST', P() + '/files/move', { body: { from, to } });
    return `moved ${from} -> ${to}`;
  },
  async delete_node({ path: p, cascade }) {
    const r = await call('DELETE', P() + '/files', { query: clean({ path: p, cascade: cascade ? 1 : undefined }) });
    return `deleted ${r.paths && r.paths.length ? r.paths.join(', ') : p}`;
  },
  async search_files({ query, glob, regex, ignore_case, max_results }) {
    const r = await call('GET', P() + '/search', { query: clean({ q: query, glob, regex: regex ? 1 : undefined, i: ignore_case ? 1 : undefined, max: max_results }) });
    if (!r.results.length) return `no matches for ${query}${glob ? ' in ' + glob : ''} (${r.files_searched} files searched)`;
    return r.results.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') + (r.truncated ? '\n… (truncated)' : '');
  },
  async run_shell({ command, cwd, timeout_ms }) {
    const r = await call('POST', P() + '/exec', { body: clean({ command, cwd, timeout_ms }) });
    let out = '';
    if (r.stdout) out += r.stdout;
    if (r.stderr) out += (out ? '\n' : '') + '[stderr]\n' + r.stderr;
    out += `\n[exit ${r.exit_code}${r.timed_out ? ' · timed out' : ''}${r.truncated ? ' · output truncated' : ''} · ${r.driver}]`;
    return out.trim();
  },
  async build({ toolchain, command, artifact_glob, label, wait }) {
    const { build } = await call('POST', P() + '/builds', { body: clean({ toolchain, command, artifact_glob, label }) });
    if (wait === false) return `queued build ${build.id} (${build.toolchain})`;
    // poll to completion, streaming nothing but returning the tail of the log
    let from = 0, status = build.status, log = '';
    const t0 = Date.now();
    while (['queued', 'running'].includes(status)) {
      if (Date.now() - t0 > 25 * 60 * 1000) return `build ${build.id} still running after 25m — check the Builds tab`;
      await sleep(1200);
      const r = await call('GET', '/api/builds/' + build.id, { query: { from } });
      status = r.build.status;
      if (r.build.log) { log += r.build.log; from = r.build.log_length; }
    }
    const done = (await call('GET', '/api/builds/' + build.id, { query: { log: 1 } })).build;
    const arts = done.artifacts && done.artifacts.length ? '\nartifacts: ' + done.artifacts.map(a => a.name + ' (' + a.size + 'B)').join(', ') : '';
    return `build ${build.id} ${status} (exit ${done.exit_code})\n----- log -----\n${done.log}${arts}`;
  },
  async set_version({ label }) {
    const { version } = await call('POST', P() + '/versions', { body: clean({ label }) });
    return `pinned version ${version.label} — ${version.files} files`;
  },
  async revert_version({ label, version_id }) {
    const { versions } = await call('GET', P() + '/versions');
    const v = versions.find(x => x.id === version_id || x.label === label) || (label ? null : versions[0]);
    if (!v) throw new Error('no matching version' + (label ? ' "' + label + '"' : '') + '; have: ' + versions.map(x => x.label).join(', '));
    await call('POST', '/api/versions/' + v.id + '/revert');
    return `reverted all files to ${v.label}`;
  },
  // The one tool that reads the laptop disk: push a file or folder up into the graph.
  // Files are collected then sent to /files/bulk in batches — one server
  // transaction and one canvas update per batch, so a 2000-file tree stays smooth.
  async upload_file({ local_path, dest_path, ignore }) {
    if (!local_path) throw new Error('local_path is required');
    const abs = path.resolve(local_path.replace(/^~(?=$|[\\/])/, require('os').homedir()));
    const st = await fsp.stat(abs).catch(() => { throw new Error('no such path on disk: ' + abs); });
    const skip = new Set(['node_modules', '.git', '.DS_Store', '__pycache__', '.venv', 'venv', 'target', 'dist', 'out', 'build', '.next', '.cache', '.idea', '.vs'].concat(Array.isArray(ignore) ? ignore : []));
    const collected = []; // { rel, data }
    const skipped = [];
    let bytes = 0;
    const add = async (fileAbs, rel) => {
      const data = await fsp.readFile(fileAbs);
      if (data.length > MAX_UPLOAD) { skipped.push(`${rel} (too large: ${fmtBytes(data.length)})`); return; }
      bytes += data.length;
      collected.push({ rel, data });
    };
    if (st.isFile()) {
      await add(abs, cleanRel(dest_path || path.basename(abs)));
    } else {
      const root = cleanRel(dest_path || path.basename(abs));
      const walk = async dir => {
        for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
          if (skip.has(e.name)) continue;
          const child = path.join(dir, e.name);
          const rel = (root ? root + '/' : '') + path.relative(abs, child).split(path.sep).join('/');
          if (e.isDirectory()) await walk(child);
          else if (e.isFile()) await add(child, rel);
          if (collected.length > 20000) throw new Error('refusing to upload more than 20000 files at once');
        }
      };
      await walk(abs);
    }
    // send in batches, keeping each request body bounded by count and total size
    let sent = 0;
    const MAX_BATCH_FILES = 300, MAX_BATCH_BYTES = 24 * 1024 * 1024;
    let batch = [], batchBytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      await call('POST', P() + '/files/bulk', { body: { files: batch.map(b => ({ path: b.rel, content_b64: b.data.toString('base64') })) } });
      sent += batch.length; batch = []; batchBytes = 0;
    };
    for (const item of collected) {
      if (batch.length >= MAX_BATCH_FILES || batchBytes + item.data.length > MAX_BATCH_BYTES) await flush();
      batch.push(item); batchBytes += item.data.length;
    }
    await flush();
    return `uploaded ${sent} file(s), ${fmtBytes(bytes)} into the graph`
      + (skipped.length ? `\nskipped ${skipped.length}: ${skipped.slice(0, 20).join(', ')}` : '');
  },
  // Pull a file node (or build artifact) back down to the laptop disk.
  async download_file({ path: p, artifact_id, local_path }) {
    let data, name;
    if (artifact_id) { data = await call('GET', '/api/artifacts/' + artifact_id + '/download', { raw: true }); name = 'artifact-' + artifact_id; }
    else {
      if (!p) throw new Error('path or artifact_id is required');
      const g = await call('GET', P() + '/tree');
      const node = findByPath(g.tree, p.replace(/^\/+|\/+$/g, ''));
      if (!node) throw new Error('no such file: ' + p);
      data = await call('GET', '/api/nodes/' + node.id + '/download', { raw: true });
      name = node.name;
    }
    const dest = path.resolve((local_path || name).replace(/^~(?=$|[\\/])/, require('os').homedir()));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, data);
    return `saved ${fmtBytes(data.length)} to ${dest}`;
  }
};

// ---- tool schemas (advertised to Claude Code) ----
const STR = d => ({ type: 'string', description: d });
const TOOLS = [
  { name: 'list_projects', description: 'List your Quist projects so you can pick one to work in.', props: {}, required: [] },
  { name: 'use_project', description: 'Select the project to work in for this session (by id or name).', props: { project_id: STR('project id'), name: STR('project name') }, required: [] },
  { name: 'list_tree', description: 'Show the resolved file/folder tree of the current project.', props: { path: STR('sub-path to start from (optional)'), depth: { type: 'integer', description: 'max depth' } }, required: [] },
  { name: 'read_file', description: 'Read a text file from the project graph by path.', props: { path: STR('file path, e.g. src/main.cpp') }, required: ['path'] },
  { name: 'read_files', description: 'Read several files in one call (fewer round trips than read_file).', props: { paths: { type: 'array', items: { type: 'string' }, description: 'file paths' } }, required: ['paths'] },
  { name: 'create_file', description: 'Create or overwrite a file node. Parent folders are created as needed.', props: { path: STR('file path'), content: STR('file contents') }, required: ['path'] },
  { name: 'edit_file', description: 'Edit a file in place: string replace (old_string/new_string, optional replace_all) or a full write (content).', props: { path: STR('file path'), old_string: STR('text to find'), new_string: STR('replacement'), replace_all: { type: 'boolean' }, content: STR('full new contents (alternative to old/new)') }, required: ['path'] },
  { name: 'create_folder', description: 'Create a folder node (and any missing parents).', props: { path: STR('folder path') }, required: ['path'] },
  { name: 'move_node', description: 'Move or rename a file/folder to a new path (re-parents it in the ownership graph).', props: { from: STR('current path'), to: STR('new path') }, required: ['from', 'to'] },
  { name: 'delete_node', description: 'Delete a file, or a folder (pass cascade to remove its contents; otherwise children become roots).', props: { path: STR('path'), cascade: { type: 'boolean' } }, required: ['path'] },
  { name: 'search_files', description: 'Grep across every text file in the project. Substring by default; set regex for a pattern.', props: { query: STR('text or regex'), glob: STR('limit to paths, e.g. src/**/*.ts'), regex: { type: 'boolean' }, ignore_case: { type: 'boolean' }, max_results: { type: 'integer' } }, required: ['query'] },
  { name: 'run_shell', description: 'Run a shell command in the project container/workspace. Returns stdout, stderr and exit code.', props: { command: STR('command line'), cwd: STR('working dir relative to project root'), timeout_ms: { type: 'integer' } }, required: ['command'] },
  { name: 'build', description: 'Compile with a server toolchain and wait for the result (streams the log back). toolchain is one of the presets (clang++, g++, rust, go, zig, mingw, ...) or "custom" with a command.', props: { toolchain: STR('toolchain id (default clang++)'), command: STR('override / custom command'), artifact_glob: STR('files to keep, e.g. out/app'), label: STR('a label for this build'), wait: { type: 'boolean', description: 'wait for completion (default true)' } }, required: [] },
  { name: 'set_version', description: 'Snapshot the whole graph under a label.', props: { label: STR('version label, e.g. v0.1.0') }, required: [] },
  { name: 'revert_version', description: 'Restore every file to a snapshot (by label or version_id; defaults to the latest).', props: { label: STR('version label'), version_id: STR('version id') }, required: [] },
  { name: 'upload_file', description: "Read a file or folder from THIS laptop's disk and push it into the project graph. The only tool that reads your local disk.", props: { local_path: STR('path on the laptop (file or directory)'), dest_path: STR('destination path in the project (default: basename)'), ignore: { type: 'array', items: { type: 'string' }, description: 'extra names to skip' } }, required: ['local_path'] },
  { name: 'download_file', description: "Save a project file (by path) or a build artifact (by artifact_id) to this laptop's disk.", props: { path: STR('file path in the project'), artifact_id: STR('build artifact id'), local_path: STR('where to save on the laptop') }, required: [] }
];

// ---- helpers ----
const clean = o => { const r = {}; for (const k in o) if (o[k] !== undefined && o[k] !== null && o[k] !== '') r[k] = o[k]; return r; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanRel = p => String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const fmtBytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
function renderTree(nodes, pre = '') {
  if (!nodes || !nodes.length) return pre ? '' : '(empty project)';
  return nodes.map((n, i) => {
    const last = i === nodes.length - 1;
    const line = pre + (last ? '└─ ' : '├─ ') + n.name + (n.kind === 'folder' ? '/' : '');
    const kids = n.children ? renderTree(n.children, pre + (last ? '   ' : '│  ')) : '';
    return line + (kids ? '\n' + kids : '');
  }).join('\n');
}
function findByPath(nodes, p) {
  for (const n of nodes || []) {
    if (n.path === p) return n;
    if (n.children) { const f = findByPath(n.children, p); if (f) return f; }
  }
  return null;
}

// ---- JSON-RPC over stdio ----
function write(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { write({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, { protocolVersion: PROTO, capabilities: { tools: {} }, serverInfo: { name: 'quist', version: '0.1.0' } });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    return reply(id, { tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: { type: 'object', properties: t.props, required: t.required } })) });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const fn = impl[name];
    if (!fn) return replyErr(id, -32601, 'unknown tool: ' + name);
    try {
      const text = await fn(args);
      return reply(id, { content: [{ type: 'text', text: String(text == null ? '' : text) }] });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
    }
  }
  if (id !== undefined) replyErr(id, -32601, 'method not found: ' + method);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
    Promise.resolve(handle(msg)).catch(e => { if (msg && msg.id !== undefined) replyErr(msg.id, -32603, e.message); });
  }
});
process.stdin.on('end', () => process.exit(0));
fail(`ready — ${BASE || '(no URL)'}${PROJECT ? ' · project ' + PROJECT : ''}`);
