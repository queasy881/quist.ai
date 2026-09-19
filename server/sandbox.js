'use strict';
// Where shells and builds actually run.
//
//   driver "local"  — processes spawn inside the app container, one workspace
//                     directory per project. This is what Railway gets: Railway
//                     cannot start sibling containers, so isolation is the app
//                     container itself (run as the unprivileged `unit` user, see
//                     Dockerfile) plus ulimit/timeout caps.
//   driver "docker" — one `quist-<projectId>` container per project with
//                     --network=none (or an allowlisted egress proxy), read-only
//                     rootfs, CPU/memory/pids caps. Use on a VPS or any host that
//                     exposes a Docker socket. The workspace dir is bind-mounted,
//                     so the host-side watcher in workspace.js still sees writes.
//
// Both drivers expose the same two calls: spawnShell() -> pty, exec() -> result.
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

let pty = null;
try { pty = require('node-pty'); } catch (e) { console.warn('[sandbox] node-pty unavailable (' + e.message.split('\n')[0] + '); shells fall back to pipes'); }

const WIN = process.platform === 'win32';
const ROOT = path.resolve(process.env.WORKSPACE_ROOT || path.join(os.tmpdir(), 'quist-ws'));
const BIN = path.join(__dirname, '..', 'sandbox', 'bin');
const IMAGE = process.env.SANDBOX_IMAGE || 'quist-sandbox';
const MEM = process.env.SANDBOX_MEMORY || '2g';
const CPUS = process.env.SANDBOX_CPUS || '2';
const PIDS = process.env.SANDBOX_PIDS || '512';
const NETWORK = process.env.SANDBOX_NETWORK || 'none';          // none | <docker network name>
const PROXY = process.env.SANDBOX_HTTP_PROXY || '';               // http://proxy:8888 when NETWORK is an internal net
const EXEC_TIMEOUT = Number(process.env.EXEC_TIMEOUT_MS || 120000);
const MAX_OUT = Number(process.env.EXEC_MAX_OUTPUT || 512 * 1024);

fs.mkdirSync(ROOT, { recursive: true });

const hostDir = projectId => path.join(ROOT, projectId);
const containerName = projectId => 'quist-' + projectId.replace(/[^a-z0-9]/gi, '').slice(0, 40);

// ---------- driver selection ----------
let driver = process.env.SANDBOX_DRIVER || '';
function dockerAvailable() {
  return new Promise(resolve => {
    const p = execFile('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 4000 }, (err, out) => resolve(!err && !!String(out).trim()));
    p.on('error', () => resolve(false));
  });
}
async function init() {
  if (!driver) driver = (!WIN && await dockerAvailable()) ? 'docker' : 'local';
  if (driver === 'docker' && !(await dockerAvailable())) { console.warn('[sandbox] SANDBOX_DRIVER=docker but docker is unreachable; using local'); driver = 'local'; }
  console.log('[sandbox] driver =', driver, '| workspace root =', ROOT);
  return driver;
}
const getDriver = () => driver || 'local';

// ---------- control channel (shell built-ins talk back to the server) ----------
// token -> { userId, projectId, name }
const ctlTokens = new Map();
function ctlTokenFor(userId, projectId, name) {
  for (const [tok, v] of ctlTokens) if (v.projectId === projectId && v.userId === userId) return tok;
  const tok = crypto.randomBytes(18).toString('base64url');
  ctlTokens.set(tok, { userId, projectId, name });
  return tok;
}
const resolveCtl = tok => ctlTokens.get(tok) || null;
const dropCtl = projectId => { for (const [tok, v] of ctlTokens) if (v.projectId === projectId) ctlTokens.delete(tok); };

const CTL_SOCK = path.join(ROOT, 'ctl.sock');

function baseEnv(userId, projectId, projectName) {
  const port = process.env.PORT || 3000;
  const env = {
    TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'C.UTF-8',
    QUIST_PROJECT: projectName, QUIST_PROJECT_ID: projectId,
    QUIST_WORKSPACE: getDriver() === 'docker' ? '/workspace' : hostDir(projectId),
    QUIST_CTL_TOKEN: ctlTokenFor(userId, projectId, projectName),
    QUIST_CTL_URL: getDriver() === 'docker' ? 'http://localhost/ctl' : `http://127.0.0.1:${port}/ctl`,
    QUIST_CTL_SOCK: getDriver() === 'docker' ? '/run/quist/ctl.sock' : '',
    HISTFILE: getDriver() === 'docker' ? '/workspace/.quist/bash_history' : path.join(hostDir(projectId), '.quist', 'bash_history'),
    HISTSIZE: '2000', HISTFILESIZE: '5000'
  };
  return env;
}

// ---------- local driver ----------
function localShellCmd() {
  if (WIN) {
    const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'].find(p => fs.existsSync(p));
    if (gitBash) return { file: gitBash, args: ['--rcfile', path.join(__dirname, '..', 'sandbox', 'bashrc'), '-i'] };
    return { file: 'powershell.exe', args: ['-NoLogo'] };
  }
  return { file: '/bin/bash', args: ['--rcfile', path.join(__dirname, '..', 'sandbox', 'bashrc'), '-i'] };
}

function localEnv(extra) {
  const env = { ...process.env, ...extra };
  env.PATH = BIN + path.delimiter + (process.env.PATH || '');
  if (WIN) env.PATH = BIN + path.delimiter + 'C:\\Program Files\\Git\\usr\\bin' + path.delimiter + env.PATH;
  env.HOME = env.HOME || os.homedir();
  return env;
}

// ---------- docker driver ----------
function dockerRunArgs(projectId, env) {
  const args = ['run', '-d', '--rm', '--name', containerName(projectId),
    '--memory', MEM, '--cpus', CPUS, '--pids-limit', PIDS,
    '--read-only', '--tmpfs', '/tmp:rw,exec,size=1g', '--tmpfs', '/home/unit:rw,exec,size=512m',
    '--security-opt', 'no-new-privileges',
    '-v', `${hostDir(projectId)}:/workspace`, '-v', `${BIN}:/opt/quist/bin:ro`, '-v', `${path.join(__dirname, '..', 'sandbox', 'bashrc')}:/opt/quist/bashrc:ro`,
    '-v', `${path.dirname(CTL_SOCK)}:/run/quist`,
    '-w', '/workspace', '--network', NETWORK];
  if (PROXY && NETWORK !== 'none') args.push('-e', `HTTP_PROXY=${PROXY}`, '-e', `HTTPS_PROXY=${PROXY}`, '-e', `http_proxy=${PROXY}`, '-e', `https_proxy=${PROXY}`);
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push('-e', 'PATH=/opt/quist/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/go/bin:/home/unit/.cargo/bin');
  args.push(IMAGE, 'sleep', 'infinity');
  return args;
}

const dockerRunning = new Map(); // projectId -> Promise<void>
function ensureContainer(projectId, env) {
  if (!dockerRunning.has(projectId)) {
    dockerRunning.set(projectId, new Promise((resolve, reject) => {
      execFile('docker', ['inspect', '-f', '{{.State.Running}}', containerName(projectId)], (err, out) => {
        if (!err && String(out).trim() === 'true') return resolve();
        execFile('docker', dockerRunArgs(projectId, env), { timeout: 60000 }, (e2, _o, stderr) => {
          if (e2) { dockerRunning.delete(projectId); return reject(new Error('docker run failed: ' + String(stderr || e2.message).trim())); }
          resolve();
        });
      });
    }));
  }
  return dockerRunning.get(projectId);
}
function stopContainer(projectId) {
  dockerRunning.delete(projectId);
  return new Promise(resolve => execFile('docker', ['rm', '-f', containerName(projectId)], () => resolve()));
}

// ---------- pipe fallback when node-pty is missing ----------
function pipeShell(file, args, opts) {
  const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, stdio: 'pipe' });
  const handlers = { data: [], exit: [] };
  child.stdout.on('data', d => handlers.data.forEach(h => h(d.toString())));
  child.stderr.on('data', d => handlers.data.forEach(h => h(d.toString())));
  child.on('exit', code => handlers.exit.forEach(h => h({ exitCode: code })));
  return {
    pid: child.pid, pipe: true,
    onData: h => handlers.data.push(h), onExit: h => handlers.exit.push(h),
    write: d => { try { child.stdin.write(d.replace(/\r/g, '\n')); } catch (_) { /* closed */ } },
    resize: () => {}, kill: () => { try { child.kill(); } catch (_) { /* gone */ } }
  };
}

function ptyShell(file, args, opts) {
  const p = pty.spawn(file, args, { name: 'xterm-256color', cols: opts.cols || 100, rows: opts.rows || 28, cwd: opts.cwd, env: opts.env });
  return {
    pid: p.pid, pipe: false,
    onData: h => p.onData(h), onExit: h => p.onExit(h),
    write: d => p.write(d), resize: (c, r) => { try { p.resize(Math.max(2, c), Math.max(2, r)); } catch (_) { /* ignore */ } },
    kill: () => { try { p.kill(); } catch (_) { /* gone */ } }
  };
}

// Spawn an interactive shell for a project. Resolves to a pty-like handle.
async function spawnShell({ userId, projectId, projectName, cols, rows }) {
  const dir = hostDir(projectId);
  fs.mkdirSync(path.join(dir, '.quist'), { recursive: true });
  const env = baseEnv(userId, projectId, projectName);
  const make = pty ? ptyShell : pipeShell;
  if (getDriver() === 'docker') {
    await ensureContainer(projectId, env);
    return make('docker', ['exec', '-i' + (pty ? 't' : ''), containerName(projectId), 'bash', '--rcfile', '/opt/quist/bashrc', '-i'], { cwd: dir, env: process.env, cols, rows });
  }
  const sh = localShellCmd();
  return make(sh.file, sh.args, { cwd: dir, env: localEnv(env), cols, rows });
}

// Run one command to completion with a timeout. Output is capped.
async function exec({ userId, projectId, projectName, command, timeoutMs, cwd, onData, onSpawn }) {
  const dir = hostDir(projectId);
  fs.mkdirSync(path.join(dir, '.quist'), { recursive: true });
  const env = baseEnv(userId, projectId, projectName);
  const limit = Math.min(Number(timeoutMs) || EXEC_TIMEOUT, Number(process.env.EXEC_TIMEOUT_MAX_MS || 3600000));
  const secs = Math.max(1, Math.ceil(limit / 1000));
  let file, args, spawnEnv, spawnCwd;
  if (getDriver() === 'docker') {
    await ensureContainer(projectId, env);
    file = 'docker';
    args = ['exec', '-w', '/workspace' + (cwd ? '/' + cwd : ''), containerName(projectId), 'timeout', '-k', '5', String(secs), 'bash', '-lc', command];
    spawnEnv = process.env; spawnCwd = dir;
  } else {
    spawnCwd = cwd ? path.join(dir, cwd) : dir;
    spawnEnv = localEnv(env);
    if (WIN) {
      const sh = localShellCmd();
      file = sh.file; args = sh.file.endsWith('bash.exe') ? ['-lc', command] : ['-NoLogo', '-Command', command];
    } else {
      // Pass the command via an env var so the INNER shell parses it. Embedding
      // it in the wrapper string would let the outer shell expand $(...) and
      // mangle escapes like \( \) — breaking any preset that globs sources.
      file = '/bin/bash';
      spawnEnv = { ...spawnEnv, QUIST_CMD: command };
      args = ['-c', `ulimit -v ${Number(process.env.EXEC_MAX_VMEM_KB || 4194304)} 2>/dev/null; exec timeout -k 5 ${secs} bash -c "$QUIST_CMD"`];
    }
  }
  return new Promise(resolve => {
    const child = spawn(file, args, { cwd: spawnCwd, env: { ...spawnEnv, BASH_ENV: path.join(__dirname, '..', 'sandbox', 'bashrc') }, stdio: ['ignore', 'pipe', 'pipe'] });
    if (onSpawn) onSpawn(child);
    let out = '', err = '', total = 0, timedOut = false, truncated = false;
    const take = (which, d) => {
      const s = d.toString();
      total += s.length;
      if (onData) onData(s, which);
      if (total > MAX_OUT) { truncated = true; return; }
      if (which === 'stdout') out += s; else err += s;
    };
    child.stdout.on('data', d => take('stdout', d));
    child.stderr.on('data', d => take('stderr', d));
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }, limit + 6000);
    child.on('error', e => { clearTimeout(timer); resolve({ stdout: out, stderr: err + '\n' + e.message, code: 127, timedOut, truncated }); });
    child.on('close', code => { clearTimeout(timer); resolve({ stdout: out, stderr: err, code: code == null ? -1 : code, timedOut: timedOut || code === 124, truncated }); });
  });
}

async function teardown(projectId) {
  dropCtl(projectId);
  if (getDriver() === 'docker') await stopContainer(projectId);
}

module.exports = { init, getDriver, hostDir, ROOT, CTL_SOCK, BIN, spawnShell, exec, teardown, resolveCtl, ctlTokenFor, hasPty: () => !!pty };
