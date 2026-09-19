'use strict';
// WebSocket endpoints:
//   /ws/terminal/:projectId — one shell per project, shared by every tab the user
//                             has open; keystrokes in, output out, plus JSON
//                             control frames (graph events, `open` requests).
//   /ws/build/:projectId    — build status + streamed logs.
//
// Frames are JSON: { t: 'in'|'out'|'resize'|'replay'|'graph'|'open'|'status'|'exit'|'build'|'log'|'ping'|'pong', ... }
const { WebSocketServer } = require('ws');
const { q } = require('./db');
const { resolveUser } = require('./auth');
const graph = require('./graph');
const workspace = require('./workspace');
const sandbox = require('./sandbox');

const SCROLLBACK_MAX = Number(process.env.SCROLLBACK_BYTES || 256 * 1024);

// projectId -> { pty, scrollback, clients:Set<ws>, dirty, flushTimer, userId, name }
const shells = new Map();

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const broadcast = (set, obj) => { const s = JSON.stringify(obj); for (const ws of set) if (ws.readyState === 1) ws.send(s); };

// Strip content/blob from graph events before they go to the browser.
function publicEvent(ev) {
  const out = { ...ev };
  delete out.content; delete out.blob;
  if (out.changed) { out.changed = { ...out.changed }; delete out.changed.content; delete out.changed.blob; }
  return out;
}

async function flushScrollback(projectId, force) {
  const s = shells.get(projectId);
  if (!s || (!s.dirty && !force)) return;
  s.dirty = false;
  await q(`INSERT INTO terminal_sessions(project_id, scrollback, updated_at) VALUES ($1,$2,now())
           ON CONFLICT (project_id) DO UPDATE SET scrollback = EXCLUDED.scrollback, updated_at = now()`, [projectId, s.scrollback]).catch(() => {});
}

async function getShell(user, project, cols, rows) {
  let s = shells.get(project.id);
  if (s && s.pty) return s;
  const prev = await q('SELECT scrollback FROM terminal_sessions WHERE project_id = $1', [project.id]);
  s = s || { clients: new Set(), scrollback: prev.rows.length ? prev.rows[0].scrollback : '', dirty: false, userId: user.id, name: project.name };
  shells.set(project.id, s);
  const ws = await workspace.get(user.id, project.id, project.name);
  ws.pinned = true;
  const pty = await sandbox.spawnShell({ userId: user.id, projectId: project.id, projectName: project.name, cols, rows });
  s.pty = pty;
  s.pipe = pty.pipe;
  pty.onData(d => {
    s.scrollback = (s.scrollback + d).slice(-SCROLLBACK_MAX);
    s.dirty = true;
    broadcast(s.clients, { t: 'out', d });
  });
  pty.onExit(({ exitCode }) => {
    s.pty = null;
    broadcast(s.clients, { t: 'exit', code: exitCode });
    const w = workspace.peek(project.id);
    if (w) { w.pinned = false; w.touch(); }
    flushScrollback(project.id, true);
  });
  if (!s.flushTimer) s.flushTimer = setInterval(() => flushScrollback(project.id), 2000);
  if (pty.pipe) broadcast(s.clients, { t: 'out', d: '\r\n\x1b[38;2;110;110;110m(node-pty unavailable — line mode shell)\x1b[0m\r\n' });
  return s;
}

// Called by the /ctl/open built-in: tell the browser to open a file node.
async function requestOpen(projectId, relPath) {
  const s = shells.get(projectId);
  const g = await graph.loadGraph(projectId);
  const t = graph.resolveTree(g.nodes, g.edges);
  const n = t.byPath.get(graph.cleanPath(relPath));
  if (!n) return { ok: false, error: 'no such file in the graph: ' + relPath };
  if (n.kind !== 'file') return { ok: false, error: relPath + ' is a folder' };
  if (s) broadcast(s.clients, { t: 'open', nodeId: n.id, path: relPath });
  return { ok: true, nodeId: n.id };
}

function attach(server) {
  const wssTerm = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const wssBuild = new WebSocketServer({ noServer: true });

  // ---- graph events -> every tab with the project open ----
  graph.events.on('graph', ev => {
    const s = shells.get(ev.projectId);
    if (s) broadcast(s.clients, { t: 'graph', ev: publicEvent(ev) });
  });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/ws\/(terminal|build)\/([0-9a-f-]{36})$/);
    if (!m) { socket.destroy(); return; }
    // cookies are parsed by hand here; express middleware doesn't run on upgrade
    req.cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
    const bearer = url.searchParams.get('token');
    if (bearer) req.headers.authorization = 'Bearer ' + bearer;
    let user, project;
    try {
      user = await resolveUser(req);
      if (!user) throw new Error('unauthenticated');
      project = await graph.ownProject(user.id, m[2]);
    } catch (e) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    const wss = m[1] === 'terminal' ? wssTerm : wssBuild;
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, user, project));
  });

  wssTerm.on('connection', async (ws, req, user, project) => {
    let s;
    try {
      s = await getShell(user, project, 100, 28);
    } catch (e) {
      send(ws, { t: 'out', d: '\r\n\x1b[38;2;194;91;74mshell failed to start: ' + e.message + '\x1b[0m\r\n' });
      send(ws, { t: 'status', running: false });
      s = shells.get(project.id) || { clients: new Set(), scrollback: '', userId: user.id, name: project.name };
      shells.set(project.id, s);
    }
    s.clients.add(ws);
    send(ws, { t: 'replay', d: s.scrollback });
    send(ws, { t: 'status', running: !!s.pty, driver: sandbox.getDriver(), pipe: !!s.pipe });
    ws.on('message', async raw => {
      let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
      if (msg.t === 'in' && s.pty) s.pty.write(String(msg.d || ''));
      else if (msg.t === 'resize' && s.pty) s.pty.resize(Number(msg.cols) || 100, Number(msg.rows) || 28);
      else if (msg.t === 'ping') send(ws, { t: 'pong' });
      else if (msg.t === 'restart') {
        if (s.pty) s.pty.kill();
        try { await getShell(user, project, Number(msg.cols) || 100, Number(msg.rows) || 28); send(ws, { t: 'status', running: true }); }
        catch (e) { send(ws, { t: 'out', d: '\r\nshell failed: ' + e.message + '\r\n' }); }
      }
      else if (msg.t === 'clear') { s.scrollback = ''; s.dirty = true; broadcast(s.clients, { t: 'cleared' }); }
    });
    ws.on('close', () => { s.clients.delete(ws); });
  });

  wssBuild.on('connection', (ws, req, user, project) => {
    const set = buildClients.get(project.id) || new Set();
    buildClients.set(project.id, set);
    set.add(ws);
    ws.on('close', () => { set.delete(ws); if (!set.size) buildClients.delete(project.id); });
  });
}

const buildClients = new Map(); // projectId -> Set<ws>
const buildBroadcast = (projectId, obj) => { const set = buildClients.get(projectId); if (set) broadcast(set, obj); };

async function killShell(projectId) {
  const s = shells.get(projectId);
  if (!s) return;
  if (s.pty) s.pty.kill();
  clearInterval(s.flushTimer);
  await flushScrollback(projectId, true);
  shells.delete(projectId);
}

async function killAll() { for (const id of [...shells.keys()]) await killShell(id); }

module.exports = { attach, requestOpen, buildBroadcast, killShell, killAll, shells };
