'use strict';
// All /api routes. Every handler runs behind requireAuth and every query is
// scoped by req.user.id via graph.ownProject / ownNode.
const express = require('express');
const multer = require('multer');
const { q } = require('./db');
const { httpError, wrap } = require('./errors');
const { requireAuth } = require('./auth');
const graph = require('./graph');
const storage = require('./storage');
const versions = require('./versions');
const builds = require('./builds');
const workspace = require('./workspace');
const terminal = require('./terminal');
const sandbox = require('./sandbox');
const mcpTools = require('./mcp-tools');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 200 * 1024 * 1024), files: 500 } });
const num = v => (v === undefined || v === null || v === '' ? undefined : Number(v));
const bool = v => v === true || v === '1' || v === 'true';

// ---------- me ----------
router.get('/me', (req, res) => res.json({ user: { id: req.user.id, email: req.user.email }, via: req.user.via }));

// ---------- projects ----------
router.get('/projects', wrap(async (req, res) => {
  const r = await q(`SELECT p.id, p.name, p.created_at, p.updated_at,
      (SELECT count(*) FROM nodes n WHERE n.project_id = p.id) AS nodes
    FROM projects p WHERE p.user_id = $1 ORDER BY p.created_at`, [req.user.id]);
  res.json({ projects: r.rows.map(p => ({ ...p, nodes: Number(p.nodes) })) });
}));

router.post('/projects', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80) || 'untitled-unit';
  const r = await q('INSERT INTO projects(user_id, name) VALUES ($1,$2) RETURNING id, name, created_at, updated_at', [req.user.id, name]);
  res.status(201).json({ project: r.rows[0] });
}));

router.get('/projects/:id', wrap(async (req, res) => {
  const project = await graph.ownProject(req.user.id, req.params.id);
  const g = await graph.loadGraph(project.id);
  res.json({ project: { id: project.id, name: project.name, mcp_disabled: project.mcp_disabled, created_at: project.created_at, updated_at: project.updated_at }, nodes: g.nodes, edges: g.edges });
}));

router.patch('/projects/:id', wrap(async (req, res) => {
  const project = await graph.ownProject(req.user.id, req.params.id);
  const sets = [], vals = [];
  if (typeof req.body.name === 'string' && req.body.name.trim()) { vals.push(req.body.name.trim().slice(0, 80)); sets.push(`name = $${vals.length}`); }
  if (Array.isArray(req.body.mcp_disabled)) { vals.push(req.body.mcp_disabled.map(String).filter(t => mcpTools.byName(t))); sets.push(`mcp_disabled = $${vals.length}`); }
  if (!sets.length) return res.json({ project });
  vals.push(project.id);
  const r = await q(`UPDATE projects SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING id, name, mcp_disabled, created_at, updated_at`, vals);
  res.json({ project: r.rows[0] });
}));

router.delete('/projects/:id', wrap(async (req, res) => {
  const project = await graph.ownProject(req.user.id, req.params.id);
  await terminal.killShell(project.id);
  await workspace.dispose(project.id);
  // project-scoped R2 artifacts are safe to remove; content-addressed blobs are shared, so leave them.
  const r2 = require('./r2');
  if (r2.enabled()) r2.deletePrefix('artifact/' + project.id + '/').catch(() => {});
  await q('DELETE FROM projects WHERE id = $1', [project.id]);
  res.json({ ok: true });
}));

// ---------- nodes + edges (canvas) ----------
router.post('/projects/:id/nodes', wrap(async (req, res) => {
  const { kind, name, content, parent } = req.body;
  const { node, edge } = await graph.createNode(req.user.id, req.params.id, { kind, name, x: num(req.body.x), y: num(req.body.y), content, parentId: parent || null });
  res.status(201).json({ node, edge });
}));

router.get('/nodes/:id', wrap(async (req, res) => {
  const n = await graph.ownNode(req.user.id, req.params.id);
  const out = graph.publicNode(n);
  if (n.kind === 'file') {
    const data = await storage.read(n.id);
    out.content = data && !data.binary ? data.content : null;
  }
  res.json({ node: out });
}));

router.patch('/nodes/:id', wrap(async (req, res) => {
  const node = await graph.updateNode(req.user.id, req.params.id, { name: req.body.name, x: num(req.body.x), y: num(req.body.y), content: req.body.content });
  res.json({ node });
}));

// Batched position saves from canvas drags.
router.patch('/projects/:id/positions', wrap(async (req, res) => {
  await graph.ownProject(req.user.id, req.params.id);
  const items = Array.isArray(req.body.positions) ? req.body.positions.slice(0, 500) : [];
  for (const it of items) await graph.updateNode(req.user.id, it.id, { x: num(it.x), y: num(it.y) });
  res.json({ ok: true, updated: items.length });
}));

router.delete('/nodes/:id', wrap(async (req, res) => {
  const out = await graph.deleteNode(req.user.id, req.params.id, { cascade: bool(req.query.cascade) });
  res.json({ ok: true, removed: out.removed });
}));

router.post('/nodes/:id/unlink', wrap(async (req, res) => {
  const edge = await graph.unlinkNode(req.user.id, req.params.id);
  res.json({ ok: true, edge });
}));

router.get('/nodes/:id/download', wrap(async (req, res) => {
  const n = await graph.ownNode(req.user.id, req.params.id);
  if (n.kind !== 'file') throw httpError(400, 'folders cannot be downloaded');
  const data = await storage.read(n.id);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(n.name)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(data ? data.buffer : Buffer.alloc(0));
}));

router.post('/projects/:id/edges', wrap(async (req, res) => {
  const edge = await graph.createEdge(req.user.id, req.params.id, String(req.body.from), String(req.body.to));
  res.status(201).json({ edge });
}));

router.delete('/edges/:id', wrap(async (req, res) => {
  await graph.deleteEdge(req.user.id, req.params.id);
  res.json({ ok: true });
}));

// ---------- upload (browser multipart) ----------
router.post('/projects/:id/upload', upload.array('files'), wrap(async (req, res) => {
  await graph.ownProject(req.user.id, req.params.id);
  const baseX = num(req.body.x), baseY = num(req.body.y);
  const parent = req.body.parent || null;
  const paths = req.body.paths ? [].concat(req.body.paths) : [];
  const created = [];
  let i = 0;
  for (const f of req.files || []) {
    const rel = graph.cleanPath(paths[i] || f.originalname);
    i++;
    if (parent || !rel.includes('/')) {
      // flat drop: file node at the drop point, owned by `parent` if given
      let parentId = parent;
      if (rel.includes('/')) { const dirs = rel.split('/'); dirs.pop(); parentId = await graph.ensureFolderPath(req.user.id, req.params.id, dirs.join('/')); }
      const name = rel.split('/').pop();
      try {
        const { node } = await graph.createNode(req.user.id, req.params.id, { kind: 'file', name, blob: f.buffer, parentId,
          x: baseX !== undefined ? baseX + (i - 1) * 14 : undefined, y: baseY !== undefined ? baseY + (i - 1) * 10 : undefined });
        created.push(node);
      } catch (e) {
        if (e.status !== 409) throw e;
        const { node } = await graph.writeFileAtPath(req.user.id, req.params.id, rel, { blob: f.buffer });
        created.push(node);
      }
    } else {
      const { node } = await graph.writeFileAtPath(req.user.id, req.params.id, rel, { blob: f.buffer });
      created.push(node);
    }
  }
  res.status(201).json({ nodes: created });
}));

// ---------- path-based file API (MCP server, shell built-ins) ----------
router.get('/projects/:id/tree', wrap(async (req, res) => {
  const g = await graph.graphFor(req.user.id, req.params.id);
  const sub = req.query.path ? graph.cleanPath(req.query.path) : '';
  let roots = graph.treeJson(g.nodes, g.edges);
  if (sub) {
    const find = (list, p) => { for (const n of list) { if (n.path === p) return n; if (n.children) { const f = find(n.children, p); if (f) return f; } } return null; };
    const n = find(roots, sub);
    if (!n) throw httpError(404, 'no such path: ' + sub);
    roots = n.kind === 'folder' ? n.children : [n];
  }
  const depth = num(req.query.depth);
  if (depth !== undefined) {
    const trim = (list, d) => list.map(n => ({ ...n, children: n.children ? (d > 1 ? trim(n.children, d - 1) : []) : undefined }));
    roots = trim(roots, depth);
  }
  res.json({ tree: roots, text: req.query.text ? graph.treeText(g.nodes, g.edges) : undefined });
}));

router.get('/projects/:id/files', wrap(async (req, res) => {
  const p = String(req.query.path || '');
  const n = await graph.nodeAtPath(req.user.id, req.params.id, p);
  if (!n) throw httpError(404, 'no such file: ' + p);
  if (n.kind !== 'file') throw httpError(400, p + ' is a folder');
  const data = await storage.read(n.id);
  res.json({ node: n, path: graph.cleanPath(p), binary: data.binary, content: data.binary ? null : data.content, size: data.size,
    content_b64: data.binary && bool(req.query.b64) ? data.buffer.toString('base64') : undefined });
}));

router.post('/projects/:id/files/batch', wrap(async (req, res) => {
  const g = await graph.graphFor(req.user.id, req.params.id);
  const paths = (Array.isArray(req.body.paths) ? req.body.paths : []).slice(0, 200).map(graph.cleanPath);
  const ids = [], missing = [];
  for (const p of paths) { const n = g.tree.byPath.get(p); if (n && n.kind === 'file') ids.push([p, n.id]); else missing.push(p); }
  const contents = await storage.readMany(ids.map(x => x[1]));
  const files = ids.map(([p, id]) => { const c = contents.get(id) || {}; return { path: p, binary: !!c.binary, size: c.size, content: c.binary ? null : c.content }; });
  res.json({ files, missing });
}));

router.post('/projects/:id/files', wrap(async (req, res) => {
  const { path: p, content, content_b64, overwrite } = req.body;
  const blob = content_b64 !== undefined && content_b64 !== null ? Buffer.from(String(content_b64), 'base64') : undefined;
  const out = await graph.writeFileAtPath(req.user.id, req.params.id, p, { content: blob ? undefined : (content == null ? '' : String(content)), blob, overwrite: overwrite !== false });
  res.status(out.created ? 201 : 200).json({ node: out.node, created: out.created, path: graph.cleanPath(p) });
}));

// String replace or full write, done server-side so the agent gets an exact error.
router.post('/projects/:id/files/edit', wrap(async (req, res) => {
  const { path: p, old_string, new_string, replace_all, content } = req.body;
  const n = await graph.nodeAtPath(req.user.id, req.params.id, p);
  if (!n) throw httpError(404, 'no such file: ' + p);
  if (n.kind !== 'file') throw httpError(400, p + ' is a folder');
  if (content !== undefined) {
    const node = await graph.updateNode(req.user.id, n.id, { content: String(content) });
    return res.json({ node, replaced: null });
  }
  const data = await storage.read(n.id);
  if (data.binary) throw httpError(400, p + ' is binary');
  const oldS = String(old_string == null ? '' : old_string), newS = String(new_string == null ? '' : new_string);
  if (!oldS) throw httpError(400, 'old_string is required (or pass content for a full write)');
  const count = data.content.split(oldS).length - 1;
  if (count === 0) throw httpError(409, 'old_string not found in ' + p);
  if (count > 1 && !replace_all) throw httpError(409, `old_string matches ${count} times in ${p}; pass replace_all or a longer old_string`);
  const updated = replace_all ? data.content.split(oldS).join(newS) : data.content.replace(oldS, () => newS);
  const node = await graph.updateNode(req.user.id, n.id, { content: updated });
  res.json({ node, replaced: replace_all ? count : 1 });
}));

router.post('/projects/:id/folders', wrap(async (req, res) => {
  const out = await graph.createFolderAtPath(req.user.id, req.params.id, req.body.path);
  res.status(out.created ? 201 : 200).json({ node: out.node, created: out.created });
}));

router.post('/projects/:id/files/move', wrap(async (req, res) => {
  const node = await graph.movePath(req.user.id, req.params.id, String(req.body.from || ''), String(req.body.to || ''));
  res.json({ node });
}));

router.delete('/projects/:id/files', wrap(async (req, res) => {
  const out = await graph.deletePath(req.user.id, req.params.id, String(req.query.path || req.body.path || ''), { cascade: bool(req.query.cascade || req.body.cascade) });
  res.json({ ok: true, removed: out.removed, paths: out.paths });
}));

router.get('/projects/:id/search', wrap(async (req, res) => {
  const out = await graph.search(req.user.id, req.params.id, String(req.query.q || ''), { regex: bool(req.query.regex), glob: req.query.glob, ignoreCase: bool(req.query.i), maxResults: num(req.query.max) });
  res.json(out);
}));

// Run a command in the project workspace (MCP run_shell). Bounded by EXEC_TIMEOUT.
router.post('/projects/:id/exec', wrap(async (req, res) => {
  const project = await graph.ownProject(req.user.id, req.params.id);
  const command = String(req.body.command || '').trim();
  if (!command) throw httpError(400, 'command required');
  const ws = await workspace.get(req.user.id, project.id, project.name);
  const r = await ws.exec(command, { timeoutMs: num(req.body.timeout_ms), cwd: req.body.cwd ? graph.cleanPath(req.body.cwd) : undefined });
  res.json({ stdout: r.stdout, stderr: r.stderr, exit_code: r.code, timed_out: r.timedOut, truncated: r.truncated, driver: sandbox.getDriver() });
}));

// ---------- versions ----------
router.get('/projects/:id/versions', wrap(async (req, res) => res.json({ versions: await versions.list(req.user.id, req.params.id) })));
router.post('/projects/:id/versions', wrap(async (req, res) => res.status(201).json({ version: await versions.snapshot(req.user.id, req.params.id, req.body.label) })));
router.post('/versions/:id/revert', wrap(async (req, res) => res.json({ version: await versions.revert(req.user.id, req.params.id) })));
router.delete('/versions/:id', wrap(async (req, res) => res.json(await versions.remove(req.user.id, req.params.id))));

// ---------- builds + artifacts ----------
router.get('/toolchains', (req, res) => res.json({ toolchains: builds.TOOLCHAINS.map(t => ({ id: t.id, label: t.label, command: t.command, artifacts: t.artifacts })) }));
router.get('/projects/:id/builds', wrap(async (req, res) => res.json({ builds: await builds.list(req.user.id, req.params.id) })));
router.post('/projects/:id/builds', wrap(async (req, res) => res.status(202).json({ build: await builds.enqueue(req.user.id, req.params.id, req.body || {}) })));
router.get('/builds/:id', wrap(async (req, res) => res.json({ build: await builds.get(req.user.id, req.params.id, { withLog: bool(req.query.log) || req.query.from !== undefined, logFrom: num(req.query.from) }) })));
router.post('/builds/:id/cancel', wrap(async (req, res) => res.json({ build: await builds.cancel(req.user.id, req.params.id) })));
router.get('/artifacts/:id/download', wrap(async (req, res) => {
  const a = await builds.artifact(req.user.id, req.params.id);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.name.split('/').pop())}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(a.data || Buffer.alloc(0));
}));

// ---------- MCP tool manifest (what the MCP tab shows; what the MCP server enforces) ----------
router.get('/mcp/tools', (req, res) => res.json({ tools: mcpTools.TOOLS.map(t => ({ name: t.name, desc: t.desc, kind: t.kind })) }));
router.get('/projects/:id/mcp', wrap(async (req, res) => {
  const p = await graph.ownProject(req.user.id, req.params.id);
  res.json({ tools: mcpTools.TOOLS.map(t => ({ name: t.name, desc: t.desc, kind: t.kind, on: !p.mcp_disabled.includes(t.name) })) });
}));

module.exports = router;
