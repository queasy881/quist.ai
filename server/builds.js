'use strict';
// Build pipeline: queued rows in `builds`, drained by an in-process worker,
// logs streamed over /ws/build/:projectId and persisted, artifacts collected
// from the workspace dir into `artifacts`.
//
// Builds never run inside an HTTP request: POST /builds returns the queued
// row at once; MCP `build` and the shell `build` built-in poll for completion.
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { q } = require('./db');
const { httpError } = require('./errors');
const graph = require('./graph');
const workspace = require('./workspace');
const terminal = require('./terminal');
const storage = require('./storage');
const r2 = require('./r2');

const CONCURRENCY = Number(process.env.BUILD_CONCURRENCY || 1);
const KEEP = Number(process.env.BUILD_KEEP || 20);
const BUILD_TIMEOUT = Number(process.env.BUILD_TIMEOUT_MS || 20 * 60 * 1000);
const MAX_ARTIFACT = Number(process.env.MAX_ARTIFACT_BYTES || 512 * 1024 * 1024);
const MAX_ARTIFACTS = 50;

// Toolchain presets. clang++ first: better diagnostics for an agent to read.
// `sources` expands to every matching source file outside out/.
const SRC = (exts) => `$(find . -type f \\( ${exts.map(e => `-name '*.${e}'`).join(' -o ')} \\) -not -path './out/*' -not -path './.quist/*' -not -path './node_modules/*')`;
const TOOLCHAINS = [
  { id: 'clang++', label: 'C++ · clang++', command: `mkdir -p out && clang++ -std=c++20 -O2 -g -Wall -Wextra -o out/app ${SRC(['cpp', 'cc', 'cxx'])}`, artifacts: 'out/app', fallback: 'g++' },
  { id: 'g++', label: 'C++ · g++', command: `mkdir -p out && g++ -std=c++20 -O2 -g -Wall -Wextra -o out/app ${SRC(['cpp', 'cc', 'cxx'])}`, artifacts: 'out/app' },
  { id: 'clang', label: 'C · clang', command: `mkdir -p out && clang -std=c17 -O2 -g -Wall -Wextra -o out/app ${SRC(['c'])}`, artifacts: 'out/app', fallback: 'gcc' },
  { id: 'gcc', label: 'C · gcc', command: `mkdir -p out && gcc -std=c17 -O2 -g -Wall -Wextra -o out/app ${SRC(['c'])}`, artifacts: 'out/app' },
  { id: 'clang++-asan', label: 'C++ · clang++ + sanitizers', command: `mkdir -p out && clang++ -std=c++20 -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer -Wall -o out/app ${SRC(['cpp', 'cc', 'cxx'])}`, artifacts: 'out/app' },
  { id: 'mingw', label: 'Windows .exe · MinGW-w64', command: `mkdir -p out && x86_64-w64-mingw32-g++ -std=c++20 -O2 -static -o out/app.exe ${SRC(['cpp', 'cc', 'cxx', 'c'])}`, artifacts: 'out/app.exe' },
  { id: 'zig-windows', label: 'Windows .exe · zig c++', command: `mkdir -p out && zig c++ -target x86_64-windows-gnu -O2 -o out/app.exe ${SRC(['cpp', 'cc', 'cxx'])}`, artifacts: 'out/app.exe' },
  { id: 'rust', label: 'Rust · cargo', command: 'cargo build --release --color never', artifacts: 'target/release/*' },
  { id: 'go', label: 'Go', command: 'mkdir -p out && go build -o out/app .', artifacts: 'out/app' },
  { id: 'zig', label: 'Zig · zig build', command: 'zig build -Doptimize=ReleaseSafe', artifacts: 'zig-out/bin/*' },
  { id: 'java', label: 'Java · javac + jar', command: `mkdir -p out/classes && javac -d out/classes ${SRC(['java'])} && MAIN=$(grep -rl 'static void main' --include='*.java' . | head -1 | sed 's#^\\./##; s#\\.java$##; s#/#.#g') && jar cfe out/app.jar "$MAIN" -C out/classes .`, artifacts: 'out/app.jar' },
  { id: 'kotlin', label: 'Kotlin · kotlinc', command: 'mkdir -p out && kotlinc . -include-runtime -d out/app.jar', artifacts: 'out/app.jar' },
  { id: 'dotnet', label: '.NET · dotnet publish', command: 'dotnet publish -c Release -o out', artifacts: 'out/*' },
  { id: 'emscripten', label: 'WASM · emcc', command: `mkdir -p out && emcc -O2 -o out/app.html ${SRC(['cpp', 'cc', 'c'])}`, artifacts: 'out/app.*' },
  { id: 'wasm32-clang', label: 'WASM · clang --target=wasm32', command: `mkdir -p out && clang --target=wasm32 -nostdlib -O2 -Wl,--no-entry -Wl,--export-all -o out/app.wasm ${SRC(['c'])}`, artifacts: 'out/app.wasm' },
  { id: 'node', label: 'Node · npm run build', command: 'npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund; npm run build', artifacts: 'dist/**' },
  { id: 'python', label: 'Python · compileall', command: 'python3 -m compileall -q . && echo ok', artifacts: '' },
  { id: 'make', label: 'make', command: 'make', artifacts: 'out/*' },
  { id: 'cmake', label: 'CMake + Ninja', command: 'cmake -S . -B out -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build out', artifacts: 'out/*' },
  { id: 'custom', label: 'Custom command', command: '', artifacts: 'out/*' }
];
const toolchainById = id => TOOLCHAINS.find(t => t.id === id);

const publicBuild = b => ({ id: b.id, project_id: b.project_id, toolchain: b.toolchain, command: b.command, artifact_glob: b.artifact_glob, label: b.label,
  status: b.status, exit_code: b.exit_code, created_at: b.created_at, started_at: b.started_at, finished_at: b.finished_at, artifacts: b.artifacts || undefined });

async function enqueue(userId, projectId, { toolchain, command, artifact_glob, label }) {
  await graph.ownProject(userId, projectId);
  const tc = toolchainById(toolchain || 'clang++');
  if (!tc) throw httpError(400, 'unknown toolchain; one of ' + TOOLCHAINS.map(t => t.id).join(', '));
  const cmd = String(command || tc.command).trim();
  if (!cmd) throw httpError(400, 'command required for custom toolchain');
  const glob = artifact_glob !== undefined && artifact_glob !== null ? String(artifact_glob) : tc.artifacts;
  const r = await q('INSERT INTO builds(project_id, user_id, toolchain, command, artifact_glob, label) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [projectId, userId, tc.id, cmd, glob, String(label || '').slice(0, 120)]);
  const b = publicBuild(r.rows[0]);
  terminal.buildBroadcast(projectId, { t: 'build', build: b });
  setImmediate(tick);
  return b;
}

async function list(userId, projectId) {
  await graph.ownProject(userId, projectId);
  const r = await q(`SELECT b.*, COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name, 'size', a.size) ORDER BY a.name) FILTER (WHERE a.id IS NOT NULL), '[]') AS artifacts
    FROM builds b LEFT JOIN artifacts a ON a.build_id = b.id WHERE b.project_id = $1 GROUP BY b.id ORDER BY b.created_at DESC LIMIT 100`, [projectId]);
  return r.rows.map(publicBuild);
}

async function get(userId, buildId, { withLog, logFrom } = {}) {
  const r = await q(`SELECT b.*, COALESCE(json_agg(json_build_object('id', a.id, 'name', a.name, 'size', a.size) ORDER BY a.name) FILTER (WHERE a.id IS NOT NULL), '[]') AS artifacts
    FROM builds b JOIN projects p ON p.id = b.project_id LEFT JOIN artifacts a ON a.build_id = b.id WHERE b.id = $1 AND p.user_id = $2 GROUP BY b.id`, [buildId, userId]);
  if (!r.rows.length) throw httpError(404, 'no such build');
  const b = r.rows[0];
  const out = publicBuild(b);
  if (withLog) {
    const live = running.get(b.id);
    const log = live ? live.log : b.log;
    out.log = logFrom ? log.slice(Number(logFrom)) : log;
    out.log_length = log.length;
  }
  return out;
}

async function cancel(userId, buildId) {
  const b = await get(userId, buildId);
  if (b.status === 'queued') {
    await q(`UPDATE builds SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status = 'queued'`, [buildId]);
  } else if (b.status === 'running') {
    const live = running.get(buildId);
    if (live && live.kill) live.kill();
  }
  return get(userId, buildId);
}

async function artifact(userId, artifactId) {
  const r = await q('SELECT a.* FROM artifacts a JOIN projects p ON p.id = a.project_id WHERE a.id = $1 AND p.user_id = $2', [artifactId, userId]);
  if (!r.rows.length) throw httpError(404, 'no such artifact');
  const a = r.rows[0];
  if (!a.data && a.storage_key) a.data = await r2.get(a.storage_key);
  return a;
}

// ---------- worker ----------
const running = new Map(); // buildId -> { log, kill }
let active = 0;
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    while (active < CONCURRENCY) {
      const r = await q(`UPDATE builds SET status = 'running', started_at = now() WHERE id = (
          SELECT id FROM builds WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
      if (!r.rows.length) break;
      active++;
      run(r.rows[0]).catch(e => console.error('[build]', e)).finally(() => { active--; setImmediate(tick); });
    }
  } finally { ticking = false; }
}

const globToRe = g => new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');

async function collectArtifacts(dir, glob) {
  if (!glob) return [];
  const res = [];
  const patterns = glob.split(',').map(s => s.trim()).filter(Boolean).map(globToRe);
  let total = 0;
  const walk = async rel => {
    const abs = path.join(dir, rel);
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.name === '.quist' || e.name === 'node_modules' || e.name === '.git') continue;
      if (e.isDirectory()) { await walk(r); continue; }
      if (!e.isFile() || !patterns.some(p => p.test(r))) continue;
      if (/\.(d|o|obj|rlib|rmeta|pdb)$/.test(e.name)) continue;
      const st = await fsp.stat(abs + path.sep + e.name);
      if (total + st.size > MAX_ARTIFACT || res.length >= MAX_ARTIFACTS) continue;
      total += st.size;
      res.push({ name: r, size: st.size, abs: path.join(abs, e.name) });
    }
  };
  await walk('');
  return res;
}

async function run(row) {
  const id = row.id;
  const state = { log: '', kill: null, dirty: false };
  running.set(id, state);
  const project = (await q('SELECT * FROM projects WHERE id = $1', [row.project_id])).rows[0];
  const append = d => { state.log += d; state.dirty = true; terminal.buildBroadcast(row.project_id, { t: 'log', id, d }); };
  const persist = setInterval(() => { if (state.dirty) { state.dirty = false; q('UPDATE builds SET log = $2 WHERE id = $1', [id, state.log]).catch(() => {}); } }, 1000);
  terminal.buildBroadcast(row.project_id, { t: 'build', build: publicBuild({ ...row, status: 'running' }) });
  append(`$ ${row.command}\n`);
  let status = 'failed', code = null;
  try {
    if (!project) throw new Error('project vanished');
    const ws = await workspace.get(row.user_id, row.project_id, project.name);
    const t0 = Date.now();
    const result = await ws.exec(row.command, { timeoutMs: BUILD_TIMEOUT, onData: d => append(d), onSpawn: child => { state.kill = () => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }; } });
    code = result.code;
    if (result.timedOut) append('\n[build timed out]\n');
    append(`\n[exit ${code} · ${((Date.now() - t0) / 1000).toFixed(1)}s]\n`);
    if (code === 0) {
      const found = await collectArtifacts(ws.dir, row.artifact_glob);
      for (const a of found) {
        const data = await fsp.readFile(a.abs);
        if (r2.enabled()) {
          const key = `artifact/${row.project_id}/${id}/${a.name}`;
          await r2.put(key, data);
          await q('INSERT INTO artifacts(build_id, project_id, name, size, storage_key) VALUES ($1,$2,$3,$4,$5)', [id, row.project_id, a.name, a.size, key]);
        } else {
          await q('INSERT INTO artifacts(build_id, project_id, name, size, data) VALUES ($1,$2,$3,$4,$5)', [id, row.project_id, a.name, a.size, data]);
        }
        append(`[artifact] ${a.name} (${a.size} bytes)\n`);
      }
      if (!found.length && row.artifact_glob) append(`[no artifacts matched ${row.artifact_glob}]\n`);
      status = 'succeeded';
    } else {
      const tc = toolchainById(row.toolchain);
      if (tc && tc.fallback) append(`[hint] retry with toolchain "${tc.fallback}" if this looks like a compiler-specific error\n`);
    }
  } catch (e) {
    append('\n[build error] ' + e.message + '\n');
  } finally {
    clearInterval(persist);
    running.delete(id);
    const r = await q(`UPDATE builds SET status = $2, exit_code = $3, log = $4, finished_at = now() WHERE id = $1 RETURNING *`, [id, status, code, state.log]);
    const done = await get(row.user_id, id).catch(() => publicBuild(r.rows[0]));
    terminal.buildBroadcast(row.project_id, { t: 'build', build: done });
    // keep only the last N builds per project; free their R2 artifacts first
    const stale = await q(`SELECT id FROM builds WHERE project_id = $1 AND id NOT IN (SELECT id FROM builds WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2)`, [row.project_id, KEEP]).catch(() => ({ rows: [] }));
    if (stale.rows.length && r2.enabled()) {
      const keys = await q('SELECT storage_key FROM artifacts WHERE build_id = ANY($1::uuid[]) AND storage_key IS NOT NULL', [stale.rows.map(x => x.id)]).catch(() => ({ rows: [] }));
      for (const k of keys.rows) r2.del(k.storage_key).catch(() => {});
    }
    if (stale.rows.length) await q('DELETE FROM builds WHERE id = ANY($1::uuid[])', [stale.rows.map(x => x.id)]).catch(() => {});
  }
}

async function startWorker() {
  await q(`UPDATE builds SET status = 'failed', log = log || E'\\n[server restarted during build]\\n', finished_at = now() WHERE status = 'running'`);
  setInterval(() => tick().catch(() => {}), 1500);
  tick().catch(() => {});
}

module.exports = { TOOLCHAINS, enqueue, list, get, cancel, artifact, startWorker, publicBuild };
