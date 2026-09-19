'use strict';
// Two-way sync between the graph in Postgres and a directory on disk.
//
//   graph -> disk : every graph event (API, MCP, canvas) is mirrored to the
//                   workspace dir while a workspace is live.
//   disk  -> graph: chokidar watches the dir; a change made by the shell, a
//                   build, or an MCP run_shell is written back as nodes/edges
//                   with origin 'fs' so the canvas stays truthful.
//
// Echo suppression is by content hash: the manifest remembers the hash we last
// wrote or saw for every path, and an fs event whose hash matches is ignored.
// All work for one project runs through a serial queue so the two directions
// never interleave.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const chokidar = require('chokidar');
const graph = require('./graph');
const storage = require('./storage');
const sandbox = require('./sandbox');

const IDLE_MS = Number(process.env.WORKSPACE_IDLE_MS || 30 * 60 * 1000);
const RENAME_WINDOW_MS = 450;
const MAX_FILE = Number(process.env.MAX_SYNC_FILE_BYTES || 200 * 1024 * 1024);
// Directories the watcher never turns into nodes. Users extend this with .quistignore.
const DEFAULT_IGNORE = ['.quist', 'node_modules', '.git', '__pycache__', '.venv', 'venv', 'target', 'out', 'dist', 'obj', '.cache', '.gradle', 'zig-cache', 'zig-out', '.mypy_cache', '.pytest_cache'];

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const toPosix = p => p.split(path.sep).join('/');

class Workspace {
  constructor(userId, projectId, projectName) {
    this.userId = userId;
    this.projectId = projectId;
    this.projectName = projectName;
    this.dir = sandbox.hostDir(projectId);
    this.manifest = new Map();        // relPath -> { id, kind, hash }
    this.pendingUnlinks = new Map();  // relPath -> { entry, timer }
    this.chain = Promise.resolve();
    this.watcher = null;
    this.ready = null;
    this.idleTimer = null;
    this.ignore = [...DEFAULT_IGNORE];
    this.onGraph = ev => { if (ev.projectId === this.projectId) this.enqueue(() => this.applyGraphEvent(ev)); };
    graph.events.on('graph', this.onGraph);
    // a manifest left by a previous server run lets us skip rewriting unchanged files
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(this.dir, '.quist', 'manifest.json'), 'utf8'));
      for (const [k, v] of Object.entries(prev)) this.manifest.set(k, v);
    } catch (_) { /* fresh */ }
  }

  enqueue(fn) {
    const run = this.chain.then(fn, fn).catch(e => console.error('[ws]', this.projectId.slice(0, 8), e.message));
    this.chain = run;
    return run;
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!this.pinned) dispose(this.projectId); }, IDLE_MS);
  }

  // ---------- graph -> disk ----------

  async materialize() {
    if (!this.ready) this.ready = this.enqueue(() => this._materialize());
    return this.ready;
  }

  async _materialize() {
    await this.stopWatch();
    await fsp.mkdir(path.join(this.dir, '.quist'), { recursive: true });
    await this.loadIgnore();
    const g = await graph.graphFor(this.userId, this.projectId);
    // remove anything we previously materialised that is no longer in the graph
    const keep = new Set(g.tree.pathOf.values());
    for (const rel of [...this.manifest.keys()].sort((a, b) => b.length - a.length)) {
      if (!keep.has(rel)) { await fsp.rm(path.join(this.dir, rel), { recursive: true, force: true }); this.manifest.delete(rel); }
    }
    // folders first (shortest paths first), then files
    const entries = [...g.tree.pathOf.entries()].map(([id, rel]) => ({ n: g.tree.byId.get(id), rel })).sort((a, b) => a.rel.length - b.rel.length);
    for (const { n, rel } of entries) {
      const abs = path.join(this.dir, rel);
      if (n.kind === 'folder') {
        await fsp.mkdir(abs, { recursive: true });
        this.manifest.set(rel, { id: n.id, kind: 'folder', hash: '' });
      } else {
        const data = await storage.read(n.id);
        const buf = data ? data.buffer : Buffer.alloc(0);
        const h = sha(buf);
        const prev = this.manifest.get(rel);
        if (!prev || prev.hash !== h || !fs.existsSync(abs)) { await fsp.mkdir(path.dirname(abs), { recursive: true }); await fsp.writeFile(abs, buf); }
        this.manifest.set(rel, { id: n.id, kind: 'file', hash: h });
      }
    }
    await this.writeManifest();
    this.startWatch();
    this.touch();
  }

  async loadIgnore() {
    this.ignore = [...DEFAULT_IGNORE];
    try {
      const extra = await fsp.readFile(path.join(this.dir, '.quistignore'), 'utf8');
      extra.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).forEach(s => this.ignore.push(s.replace(/\/+$/, '')));
    } catch (_) { /* none */ }
  }

  isIgnored(rel) {
    const parts = rel.split('/');
    return parts.some(seg => this.ignore.includes(seg)) || rel === '.quistignore';
  }

  async writeManifest() {
    const obj = {};
    for (const [k, v] of this.manifest) obj[k] = v;
    await fsp.writeFile(path.join(this.dir, '.quist', 'manifest.json'), JSON.stringify(obj)).catch(() => {});
  }

  relOf(id, t) { return t.pathOf.get(id); }

  // Mirror one graph event onto disk (skipped for events that came from disk).
  async applyGraphEvent(ev) {
    if (!this.ready) return;
    if (ev.type === 'graph.replaced') { this.manifest.clear(); await this._materialize(); return; }
    if (ev.origin === 'fs') return; // we caused it; manifest already updated
    if (ev.type === 'node.updated' && ev.changed.oldName === undefined && ev.changed.content === undefined && ev.changed.blob === undefined) return; // position only
    const g = await graph.graphFor(this.userId, this.projectId);
    const t = g.tree;
    switch (ev.type) {
      case 'node.created': {
        const rel = t.pathOf.get(ev.node.id);
        if (!rel) return;
        const abs = path.join(this.dir, rel);
        if (ev.node.kind === 'folder') {
          await fsp.mkdir(abs, { recursive: true });
          this.manifest.set(rel, { id: ev.node.id, kind: 'folder', hash: '' });
        } else {
          const buf = ev.blob ? ev.blob : Buffer.from(ev.content || '', 'utf8');
          await fsp.mkdir(path.dirname(abs), { recursive: true });
          this.manifest.set(rel, { id: ev.node.id, kind: 'file', hash: sha(buf) });
          await fsp.writeFile(abs, buf);
        }
        break;
      }
      case 'node.updated': {
        const rel = t.pathOf.get(ev.node.id);
        if (!rel) return;
        if (ev.changed.oldName !== undefined) {
          const oldRel = this.pathFor(ev.node.id);
          if (oldRel && oldRel !== rel) await this.renameOnDisk(oldRel, rel);
        }
        if (ev.changed.content !== undefined || ev.changed.blob !== undefined) {
          const buf = ev.changed.blob ? ev.changed.blob : Buffer.from(ev.changed.content || '', 'utf8');
          const cur = this.manifest.get(rel) || { id: ev.node.id, kind: 'file' };
          cur.hash = sha(buf);
          this.manifest.set(rel, cur);
          await fsp.mkdir(path.dirname(path.join(this.dir, rel)), { recursive: true });
          await fsp.writeFile(path.join(this.dir, rel), buf);
        }
        break;
      }
      case 'node.deleted': {
        for (const id of ev.ids) {
          const rel = this.pathFor(id);
          if (!rel) continue;
          this.forgetSubtree(rel);
          await fsp.rm(path.join(this.dir, rel), { recursive: true, force: true });
        }
        // orphaned children of a non-cascade folder delete become roots on disk
        for (const id of ev.orphans || []) {
          const newRel = t.pathOf.get(id);
          if (newRel) await this.restoreFromGraph(id, newRel, g);
        }
        break;
      }
      case 'edge.created': {
        const rel = t.pathOf.get(ev.edge.to);
        const oldRel = this.pathFor(ev.edge.to) || ev.fromPath;
        if (rel && oldRel && oldRel !== rel) await this.renameOnDisk(oldRel, rel);
        else if (rel && !oldRel) await this.restoreFromGraph(ev.edge.to, rel, g);
        break;
      }
      case 'edge.deleted': {
        const rel = t.pathOf.get(ev.edge.to);
        const oldRel = this.pathFor(ev.edge.to) || ev.fromPath;
        if (rel && oldRel && oldRel !== rel) await this.renameOnDisk(oldRel, rel);
        break;
      }
      default: break;
    }
    await this.writeManifest();
  }

  pathFor(id) { for (const [rel, v] of this.manifest) if (v.id === id) return rel; return null; }

  forgetSubtree(rel) {
    for (const k of [...this.manifest.keys()]) if (k === rel || k.startsWith(rel + '/')) this.manifest.delete(k);
  }

  async renameOnDisk(oldRel, newRel) {
    const from = path.join(this.dir, oldRel), to = path.join(this.dir, newRel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    const moved = [];
    for (const [k, v] of this.manifest) if (k === oldRel || k.startsWith(oldRel + '/')) moved.push([k, v]);
    for (const [k] of moved) this.manifest.delete(k);
    for (const [k, v] of moved) this.manifest.set(newRel + k.slice(oldRel.length), v);
    try { await fsp.rename(from, to); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }

  // Write a subtree that exists in the graph but not on disk (e.g. after an orphaning).
  async restoreFromGraph(id, rel, g) {
    const n = g.tree.byId.get(id);
    if (!n) return;
    const abs = path.join(this.dir, rel);
    if (n.kind === 'folder') {
      await fsp.mkdir(abs, { recursive: true });
      this.manifest.set(rel, { id, kind: 'folder', hash: '' });
      for (const k of g.tree.kids(id)) await this.restoreFromGraph(k.id, rel + '/' + k.name, g);
    } else {
      const data = await storage.read(id);
      const buf = data ? data.buffer : Buffer.alloc(0);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, buf);
      this.manifest.set(rel, { id, kind: 'file', hash: sha(buf) });
    }
  }

  // ---------- disk -> graph ----------

  startWatch() {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.dir, {
      ignoreInitial: true, persistent: true, followSymlinks: false,
      ignored: p => { const rel = toPosix(path.relative(this.dir, p)); return rel ? this.isIgnored(rel) : false; },
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      usePolling: process.env.WATCH_POLL === '1', interval: 400
    });
    const rel = p => toPosix(path.relative(this.dir, p));
    this.watcher
      .on('add', p => this.enqueue(() => this.fsAdd(rel(p), false)))
      .on('change', p => this.enqueue(() => this.fsChange(rel(p))))
      .on('unlink', p => this.enqueue(() => this.fsUnlink(rel(p), false)))
      .on('addDir', p => { if (rel(p)) this.enqueue(() => this.fsAdd(rel(p), true)); })
      .on('unlinkDir', p => { if (rel(p)) this.enqueue(() => this.fsUnlink(rel(p), true)); })
      .on('error', e => console.error('[ws] watcher', e.message));
  }

  async stopWatch() {
    if (!this.watcher) return;
    const w = this.watcher; this.watcher = null;
    await w.close().catch(() => {});
  }

  async readDisk(rel) {
    try {
      const st = await fsp.stat(path.join(this.dir, rel));
      if (st.size > MAX_FILE) return null;
      return await fsp.readFile(path.join(this.dir, rel));
    } catch (_) { return null; }
  }

  async fsAdd(rel, isDir) {
    if (!rel || this.isIgnored(rel)) return;
    this.touch();
    if (rel.split('/').some(seg => !graph.validName(seg))) return;
    const buf = isDir ? null : await this.readDisk(rel);
    if (!isDir && buf === null) return;
    const h = isDir ? '' : sha(buf);
    const known = this.manifest.get(rel);
    if (known && known.hash === h && known.kind === (isDir ? 'folder' : 'file')) return; // echo of our own write
    // rename detection: a recent unlink with identical content
    if (!isDir) {
      for (const [oldRel, pend] of this.pendingUnlinks) {
        if (pend.entry.kind === 'file' && pend.entry.hash === h) {
          clearTimeout(pend.timer); this.pendingUnlinks.delete(oldRel);
          this.manifest.delete(oldRel);
          try {
            const moved = await graph.movePath(this.userId, this.projectId, oldRel, rel, { origin: 'fs' });
            this.manifest.set(rel, { id: moved.id, kind: 'file', hash: h });
            await this.writeManifest();
            return;
          } catch (e) { if (e.status !== 404) console.error('[ws] move', e.message); }
          break;
        }
      }
    }
    try {
      if (isDir) {
        const { node } = await graph.createFolderAtPath(this.userId, this.projectId, rel, { origin: 'fs' });
        this.manifest.set(rel, { id: node.id, kind: 'folder', hash: '' });
      } else {
        const { node } = await graph.writeFileAtPath(this.userId, this.projectId, rel, { blob: buf, origin: 'fs' });
        this.manifest.set(rel, { id: node.id, kind: 'file', hash: h });
      }
      await this.refreshFolderIds();
    } catch (e) { console.error('[ws] add', rel, e.message); }
    await this.writeManifest();
  }

  async fsChange(rel) {
    if (!rel || this.isIgnored(rel)) return;
    this.touch();
    const buf = await this.readDisk(rel);
    if (buf === null) return;
    const h = sha(buf);
    const known = this.manifest.get(rel);
    if (known && known.hash === h) return;
    try {
      const { node } = await graph.writeFileAtPath(this.userId, this.projectId, rel, { blob: buf, origin: 'fs' });
      this.manifest.set(rel, { id: node.id, kind: 'file', hash: h });
    } catch (e) { console.error('[ws] change', rel, e.message); }
    await this.writeManifest();
  }

  async fsUnlink(rel, isDir) {
    if (!rel || this.isIgnored(rel)) return;
    this.touch();
    const known = this.manifest.get(rel);
    if (!known) return; // already gone from the graph (API delete echo)
    if (isDir) {
      this.forgetSubtree(rel);
      try { await graph.deletePath(this.userId, this.projectId, rel, { origin: 'fs', cascade: true }); } catch (e) { if (e.status !== 404) console.error('[ws] rmdir', rel, e.message); }
      await this.writeManifest();
      return;
    }
    // hold the delete briefly so a following `add` with the same content becomes a rename
    const timer = setTimeout(() => this.enqueue(async () => {
      if (!this.pendingUnlinks.has(rel)) return;
      this.pendingUnlinks.delete(rel);
      this.manifest.delete(rel);
      try { await graph.deleteNode(this.userId, known.id, { origin: 'fs' }); } catch (e) { if (e.status !== 404) console.error('[ws] rm', rel, e.message); }
      await this.writeManifest();
    }), RENAME_WINDOW_MS);
    this.pendingUnlinks.set(rel, { entry: known, timer });
  }

  // Folders created implicitly by writeFileAtPath need manifest entries too.
  async refreshFolderIds() {
    const g = await graph.graphFor(this.userId, this.projectId);
    for (const [id, rel] of g.tree.pathOf) {
      const n = g.tree.byId.get(id);
      if (n.kind === 'folder' && !this.manifest.has(rel)) this.manifest.set(rel, { id, kind: 'folder', hash: '' });
    }
  }

  // Run a command in this workspace and let the watcher settle before returning.
  async exec(command, opts = {}) {
    await this.materialize();
    this.touch();
    const r = await sandbox.exec({ userId: this.userId, projectId: this.projectId, projectName: this.projectName, command, timeoutMs: opts.timeoutMs, cwd: opts.cwd, onData: opts.onData, onSpawn: opts.onSpawn });
    await this.settle();
    return r;
  }

  // Wait for queued watcher work (plus the rename window) to drain.
  async settle() {
    await new Promise(r => setTimeout(r, 350));
    await this.enqueue(async () => {});
    if (this.pendingUnlinks.size) { await new Promise(r => setTimeout(r, RENAME_WINDOW_MS + 50)); await this.enqueue(async () => {}); }
  }

  async dispose() {
    graph.events.off('graph', this.onGraph);
    clearTimeout(this.idleTimer);
    for (const p of this.pendingUnlinks.values()) clearTimeout(p.timer);
    await this.stopWatch();
    await sandbox.teardown(this.projectId);
  }
}

const live = new Map(); // projectId -> Workspace

async function get(userId, projectId, projectName) {
  let ws = live.get(projectId);
  if (!ws) {
    ws = new Workspace(userId, projectId, projectName);
    live.set(projectId, ws);
  }
  await ws.materialize();
  return ws;
}

async function dispose(projectId) {
  const ws = live.get(projectId);
  if (!ws) return;
  live.delete(projectId);
  await ws.dispose();
}

const peek = projectId => live.get(projectId) || null;

async function disposeAll() { for (const id of [...live.keys()]) await dispose(id); }

module.exports = { get, dispose, disposeAll, peek, Workspace, DEFAULT_IGNORE };
