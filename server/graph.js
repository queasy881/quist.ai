'use strict';
// The graph: nodes (files/folders) + edges (folder owns node). Everything the
// canvas, the shell workspace, the MCP tools and versions do funnels through
// here so the rules are enforced once, server-side, and always user-scoped.
const EventEmitter = require('events');
const { q, tx, pool } = require('./db');
const { httpError } = require('./errors');
const storage = require('./storage');

const NW = 212, NH = 58; // node box size, matches the canvas

const LANGS = { js:'javascript', mjs:'javascript', cjs:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', py:'python', rb:'ruby', java:'java', kt:'kotlin', swift:'swift', c:'c', h:'c', cpp:'cpp', cc:'cpp', cxx:'cpp', hpp:'cpp', hh:'cpp', cs:'csharp', go:'go', rs:'rust', php:'php', lua:'lua', r:'r', dart:'dart', scala:'scala', pl:'perl', sql:'sql', json:'json', yml:'yaml', yaml:'yaml', toml:'ini', ini:'ini', xml:'xml', md:'markdown', css:'css', scss:'scss', html:'html', htm:'html', sh:'shell', bash:'shell', zsh:'shell', dockerfile:'dockerfile', txt:'plaintext', zig:'zig', hs:'haskell', ml:'ocaml', ex:'elixir', exs:'elixir', erl:'erlang', jl:'julia', nim:'nim', cr:'crystal', f90:'fortran', f:'fortran', pas:'pascal', d:'d', clj:'clojure', groovy:'groovy', fs:'fsharp', vb:'vb', cmake:'cmake', mk:'makefile' };

function langFor(name) {
  const base = String(name || '').toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile' || base === 'gnumakefile') return 'makefile';
  if (base === 'cmakelists.txt') return 'cmake';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return LANGS[ext] || 'plaintext';
}

const events = new EventEmitter();
events.setMaxListeners(0);
const emit = (projectId, type, payload, origin) => events.emit('graph', { projectId, type, origin: origin || 'api', ...payload });

const NIL = '00000000-0000-0000-0000-000000000000';
const validName = n => typeof n === 'string' && n.length > 0 && n.length <= 255 && !/[\/\\\0]/.test(n) && n !== '.' && n !== '..';
const cleanPath = p => String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').filter(s => s && s !== '.').join('/');

// ---------- ownership ----------

async function ownProject(userId, projectId, client) {
  const r = await (client || pool).query('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
  if (!r.rows.length) throw httpError(404, 'no such project');
  return r.rows[0];
}

async function ownNode(userId, nodeId, client) {
  const r = await (client || pool).query(
    `SELECT n.id, n.project_id, n.kind, n.name, n.x, n.y, n.lang, n.size, n.created_at, n.updated_at, (n.blob IS NOT NULL) AS binary
       FROM nodes n JOIN projects p ON p.id = n.project_id WHERE n.id = $1 AND p.user_id = $2`, [nodeId, userId]);
  if (!r.rows.length) throw httpError(404, 'no such node');
  return r.rows[0];
}

const publicNode = n => ({
  id: n.id, project_id: n.project_id, kind: n.kind, name: n.name, x: n.x, y: n.y, lang: n.lang,
  size: Number(n.size || 0), binary: n.binary === true,
  created_at: n.created_at, updated_at: n.updated_at
});

// ---------- loading + tree ----------

async function loadGraph(projectId, client) {
  const c = client || pool;
  const [n, e] = await Promise.all([
    c.query('SELECT id, project_id, kind, name, x, y, lang, size, created_at, updated_at, (blob IS NOT NULL) AS binary FROM nodes WHERE project_id = $1 ORDER BY created_at', [projectId]),
    c.query('SELECT id, from_node AS "from", to_node AS "to" FROM edges WHERE project_id = $1 ORDER BY created_at', [projectId])
  ]);
  return { nodes: n.rows.map(publicNode), edges: e.rows };
}

const byKindThenName = (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1);

// Resolve ownership into paths. Returns maps both ways plus root list.
function resolveTree(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const parentOf = new Map();
  const childrenOf = new Map();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    parentOf.set(e.to, e.from);
    if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
    childrenOf.get(e.from).push(byId.get(e.to));
  }
  for (const arr of childrenOf.values()) arr.sort(byKindThenName);
  const roots = nodes.filter(n => !parentOf.has(n.id)).sort(byKindThenName);
  const pathOf = new Map();
  const byPath = new Map();
  const walk = (n, prefix) => {
    const p = prefix ? prefix + '/' + n.name : n.name;
    pathOf.set(n.id, p);
    byPath.set(p, n);
    for (const k of childrenOf.get(n.id) || []) walk(k, p);
  };
  roots.forEach(r => walk(r, ''));
  const kids = id => childrenOf.get(id) || [];
  return { byId, parentOf, childrenOf, kids, roots, pathOf, byPath };
}

function treeText(nodes, edges) {
  const t = resolveTree(nodes, edges);
  if (!t.roots.length) return '(no nodes yet)';
  const walk = (n, pre, last, top) => {
    let out = pre + (top ? '' : (last ? '└─ ' : '├─ ')) + n.name + (n.kind === 'folder' ? '/' : '');
    const ks = t.kids(n.id);
    ks.forEach((k, i) => { out += '\n' + walk(k, pre + (top ? '' : (last ? '   ' : '│  ')), i === ks.length - 1, false); });
    return out;
  };
  return t.roots.map(r => walk(r, '', true, true)).join('\n');
}

function treeJson(nodes, edges) {
  const t = resolveTree(nodes, edges);
  const walk = n => ({
    id: n.id, name: n.name, kind: n.kind, path: t.pathOf.get(n.id),
    lang: n.kind === 'file' ? n.lang : undefined, size: n.kind === 'file' ? n.size : undefined, binary: n.binary || undefined,
    children: n.kind === 'folder' ? t.kids(n.id).map(walk) : undefined
  });
  return t.roots.map(walk);
}

// Find a free spot on the canvas near (x, y), same rule as the UI.
function freeSpot(nodes, x, y) {
  let px = x, py = y, guard = 0;
  const hit = () => nodes.some(n => Math.abs(n.x - px) < NW + 16 && Math.abs(n.y - py) < NH + 16);
  while (hit() && guard++ < 80) { px += 26; py += NH + 18; }
  return { x: px, y: py };
}

// Where to put a new node that is owned by `parentId` (or a new root).
function placeNear(nodes, edges, parentId) {
  const t = resolveTree(nodes, edges);
  if (parentId && t.byId.has(parentId)) {
    const p = t.byId.get(parentId);
    return freeSpot(nodes, p.x + NW + 96, p.y + t.kids(parentId).length * (NH + 18));
  }
  return freeSpot(nodes, 120, 120 + t.roots.length * (NH + 18));
}

// Sibling names must be unique so the graph maps 1:1 onto a filesystem.
async function siblingClash(client, projectId, parentId, name, excludeId) {
  const r = parentId
    ? await client.query('SELECT n.id FROM nodes n JOIN edges e ON e.to_node = n.id WHERE e.from_node = $1 AND n.name = $2 AND n.id <> $3', [parentId, name, excludeId || NIL])
    : await client.query('SELECT n.id FROM nodes n WHERE n.project_id = $1 AND n.name = $2 AND n.id <> $3 AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.to_node = n.id)', [projectId, name, excludeId || NIL]);
  return r.rows.length > 0;
}

// ---------- mutations ----------

// opts: { kind, name, x, y, content, blob, parentId, origin }
async function createNode(userId, projectId, opts) {
  const { kind, name } = opts;
  if (kind !== 'file' && kind !== 'folder') throw httpError(400, 'kind must be file or folder');
  if (!validName(name)) throw httpError(400, 'invalid name');
  const out = await tx(async c => {
    await ownProject(userId, projectId, c);
    const parentId = opts.parentId || null;
    if (parentId) {
      const p = await c.query('SELECT kind FROM nodes WHERE id = $1 AND project_id = $2', [parentId, projectId]);
      if (!p.rows.length) throw httpError(404, 'no such parent');
      if (p.rows[0].kind !== 'folder') throw httpError(400, 'only folders can own nodes');
    }
    if (await siblingClash(c, projectId, parentId, name)) throw httpError(409, `"${name}" already exists ${parentId ? 'in that folder' : 'at the root'}`);
    let x = opts.x, y = opts.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) {
      const g = await loadGraph(projectId, c);
      ({ x, y } = placeNear(g.nodes, g.edges, parentId));
    }
    const lang = kind === 'file' ? langFor(name) : null;
    const stored = kind === 'file'
      ? await storage.prepare(opts.blob != null ? opts.blob : (opts.content != null ? opts.content : ''))
      : { content: null, blob: null, size: 0 };
    const r = await c.query(
      `INSERT INTO nodes(project_id, kind, name, x, y, content, blob, lang, size) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, project_id, kind, name, x, y, lang, size, created_at, updated_at, (blob IS NOT NULL) AS binary`,
      [projectId, kind, name, x, y, stored.content, stored.blob, lang, stored.size]);
    const node = publicNode(r.rows[0]);
    let edge = null;
    if (parentId) {
      const e = await c.query('INSERT INTO edges(project_id, from_node, to_node) VALUES ($1,$2,$3) RETURNING id, from_node AS "from", to_node AS "to"', [projectId, parentId, node.id]);
      edge = e.rows[0];
    }
    await c.query('UPDATE projects SET updated_at = now() WHERE id = $1', [projectId]);
    return { node, edge, content: stored.content, blob: stored.blob };
  });
  emit(projectId, 'node.created', { node: out.node, edge: out.edge, content: out.content, blob: out.blob }, opts.origin);
  return out;
}

// opts: { name, x, y, content, blob, origin }
async function updateNode(userId, nodeId, opts) {
  const out = await tx(async c => {
    const n = await ownNode(userId, nodeId, c);
    const sets = [], vals = [];
    const push = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    const changed = {};
    if (opts.name !== undefined && opts.name !== n.name) {
      if (!validName(opts.name)) throw httpError(400, 'invalid name');
      const parent = await c.query('SELECT from_node FROM edges WHERE to_node = $1', [nodeId]);
      const parentId = parent.rows.length ? parent.rows[0].from_node : null;
      if (await siblingClash(c, n.project_id, parentId, opts.name, nodeId)) throw httpError(409, `"${opts.name}" already exists there`);
      push('name', opts.name); changed.name = opts.name; changed.oldName = n.name;
      if (n.kind === 'file') { const l = langFor(opts.name); push('lang', l); changed.lang = l; }
    }
    if (typeof opts.x === 'number' && isFinite(opts.x)) { push('x', opts.x); changed.x = opts.x; }
    if (typeof opts.y === 'number' && isFinite(opts.y)) { push('y', opts.y); changed.y = opts.y; }
    if (opts.content !== undefined || opts.blob !== undefined) {
      if (n.kind !== 'file') throw httpError(400, 'folders have no content');
      const stored = await storage.prepare(opts.blob != null ? opts.blob : (opts.content == null ? '' : opts.content));
      push('content', stored.content); push('blob', stored.blob); push('size', stored.size);
      changed.content = stored.content; changed.blob = stored.blob; changed.size = stored.size;
    }
    if (!sets.length) return { node: publicNode(n), changed, projectId: n.project_id };
    vals.push(nodeId);
    const r = await c.query(`UPDATE nodes SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}
      RETURNING id, project_id, kind, name, x, y, lang, size, created_at, updated_at, (blob IS NOT NULL) AS binary`, vals);
    await c.query('UPDATE projects SET updated_at = now() WHERE id = $1', [n.project_id]);
    return { node: publicNode(r.rows[0]), changed, projectId: n.project_id };
  });
  if (Object.keys(out.changed).length) emit(out.projectId, 'node.updated', { node: out.node, changed: out.changed }, opts.origin);
  return out.node;
}

// Deleting a folder orphans its children (edges cascade away) unless cascade is set.
async function deleteNode(userId, nodeId, opts = {}) {
  const out = await tx(async c => {
    const n = await ownNode(userId, nodeId, c);
    const removed = [n.id];
    if (n.kind === 'folder' && opts.cascade) {
      const r = await c.query(`WITH RECURSIVE down AS (
          SELECT to_node AS n FROM edges WHERE from_node = $1
          UNION SELECT e.to_node FROM edges e JOIN down ON e.from_node = down.n)
        SELECT n FROM down`, [nodeId]);
      removed.push(...r.rows.map(x => x.n));
    }
    const g = await loadGraph(n.project_id, c);
    const t = resolveTree(g.nodes, g.edges);
    const paths = removed.map(id => t.pathOf.get(id)).filter(Boolean);
    const orphans = opts.cascade || n.kind !== 'folder' ? [] : t.kids(n.id).map(k => k.id);
    await c.query('DELETE FROM nodes WHERE id = ANY($1::uuid[])', [removed]);
    await c.query('UPDATE projects SET updated_at = now() WHERE id = $1', [n.project_id]);
    return { removed, paths, orphans, projectId: n.project_id, kind: n.kind, name: n.name };
  });
  emit(out.projectId, 'node.deleted', { ids: out.removed, paths: out.paths, orphans: out.orphans, kind: out.kind, name: out.name }, opts.origin);
  return out;
}

// `from` owns `to`. Replaces any existing owner of `to`. Cycle and kind rules
// are checked here for a friendly message and again by the DB trigger.
async function createEdge(userId, projectId, from, to, opts = {}) {
  const out = await tx(async c => {
    await ownProject(userId, projectId, c);
    const nodes = await c.query('SELECT id, kind, name FROM nodes WHERE project_id = $1 AND id = ANY($2::uuid[])', [projectId, [from, to]]);
    const f = nodes.rows.find(n => n.id === from), t = nodes.rows.find(n => n.id === to);
    if (!f || !t) throw httpError(404, 'no such node');
    if (f.kind !== 'folder') throw httpError(400, 'only folders can own nodes');
    if (from === to) throw httpError(400, 'a folder cannot own itself');
    const g = await loadGraph(projectId, c);
    const tree = resolveTree(g.nodes, g.edges);
    for (let cur = from; cur; cur = tree.parentOf.get(cur)) if (cur === to) throw httpError(400, 'link refused — would create a cycle');
    if (tree.parentOf.get(to) !== from && await siblingClash(c, projectId, from, t.name, to)) throw httpError(409, `"${t.name}" already exists in ${f.name}/`);
    const before = tree.pathOf.get(to);
    const old = await c.query('DELETE FROM edges WHERE to_node = $1 RETURNING id', [to]);
    const r = await c.query('INSERT INTO edges(project_id, from_node, to_node) VALUES ($1,$2,$3) RETURNING id, from_node AS "from", to_node AS "to"', [projectId, from, to]);
    await c.query('UPDATE projects SET updated_at = now() WHERE id = $1', [projectId]);
    return { edge: r.rows[0], replaced: old.rows.map(x => x.id), before };
  });
  emit(projectId, 'edge.created', { edge: out.edge, replaced: out.replaced, fromPath: out.before }, opts.origin);
  return out.edge;
}

async function deleteEdge(userId, edgeId, opts = {}) {
  const out = await tx(async c => {
    const r = await c.query(`SELECT e.id, e.project_id, e.from_node AS "from", e.to_node AS "to" FROM edges e JOIN projects p ON p.id = e.project_id WHERE e.id = $1 AND p.user_id = $2`, [edgeId, userId]);
    if (!r.rows.length) throw httpError(404, 'no such link');
    const e = r.rows[0];
    const g = await loadGraph(e.project_id, c);
    const t = resolveTree(g.nodes, g.edges);
    const child = t.byId.get(e.to);
    if (child && await siblingClash(c, e.project_id, null, child.name, e.to)) throw httpError(409, `"${child.name}" already exists at the root`);
    await c.query('DELETE FROM edges WHERE id = $1', [edgeId]);
    await c.query('UPDATE projects SET updated_at = now() WHERE id = $1', [e.project_id]);
    return { edge: e, fromPath: t.pathOf.get(e.to) };
  });
  emit(out.edge.project_id, 'edge.deleted', { edge: out.edge, fromPath: out.fromPath }, opts.origin);
  return out.edge;
}

async function unlinkNode(userId, nodeId, opts = {}) {
  const n = await ownNode(userId, nodeId);
  const r = await q('SELECT id FROM edges WHERE to_node = $1', [n.id]);
  if (!r.rows.length) return null;
  return deleteEdge(userId, r.rows[0].id, opts);
}

// ---------- path based (used by MCP, uploads, the shell workspace) ----------

async function graphFor(userId, projectId) {
  await ownProject(userId, projectId);
  const g = await loadGraph(projectId);
  return { ...g, tree: resolveTree(g.nodes, g.edges) };
}

async function nodeAtPath(userId, projectId, p) {
  const g = await graphFor(userId, projectId);
  return g.tree.byPath.get(cleanPath(p)) || null;
}

// Create the folder chain for dirPath, returning the id of the last folder (null for root).
async function ensureFolderPath(userId, projectId, dirPath, opts = {}) {
  const parts = cleanPath(dirPath).split('/').filter(Boolean);
  let parentId = null;
  let g = await graphFor(userId, projectId);
  let cur = '';
  for (const part of parts) {
    cur = cur ? cur + '/' + part : part;
    const existing = g.tree.byPath.get(cur);
    if (existing) {
      if (existing.kind !== 'folder') throw httpError(409, `${cur} is a file`);
      parentId = existing.id;
      continue;
    }
    const { node } = await createNode(userId, projectId, { kind: 'folder', name: part, parentId, origin: opts.origin });
    parentId = node.id;
    g = await graphFor(userId, projectId);
  }
  return parentId;
}

// Write a file at path, creating folders. opts: { content | blob, overwrite=true, origin, x, y }
async function writeFileAtPath(userId, projectId, p, opts = {}) {
  const full = cleanPath(p);
  if (!full) throw httpError(400, 'path required');
  const parts = full.split('/');
  const name = parts.pop();
  if (!validName(name)) throw httpError(400, 'invalid file name');
  const g = await graphFor(userId, projectId);
  const existing = g.tree.byPath.get(full);
  if (existing) {
    if (existing.kind !== 'file') throw httpError(409, `${full} is a folder`);
    if (opts.overwrite === false) throw httpError(409, `${full} already exists`);
    const node = await updateNode(userId, existing.id, { content: opts.content, blob: opts.blob, origin: opts.origin });
    return { node, created: false };
  }
  const parentId = parts.length ? await ensureFolderPath(userId, projectId, parts.join('/'), opts) : null;
  const { node } = await createNode(userId, projectId, { kind: 'file', name, parentId, content: opts.content, blob: opts.blob, x: opts.x, y: opts.y, origin: opts.origin });
  return { node, created: true };
}

async function createFolderAtPath(userId, projectId, p, opts = {}) {
  const full = cleanPath(p);
  if (!full) throw httpError(400, 'path required');
  const g = await graphFor(userId, projectId);
  const existing = g.tree.byPath.get(full);
  if (existing) {
    if (existing.kind !== 'folder') throw httpError(409, `${full} is a file`);
    return { node: existing, created: false };
  }
  const id = await ensureFolderPath(userId, projectId, full, opts);
  const g2 = await graphFor(userId, projectId);
  return { node: g2.tree.byId.get(id), created: true };
}

// Move/rename: `from` is a path (or node id), `to` is the full new path.
async function movePath(userId, projectId, from, to, opts = {}) {
  const g = await graphFor(userId, projectId);
  const src = g.tree.byPath.get(cleanPath(from)) || g.tree.byId.get(from);
  if (!src) throw httpError(404, `no such node: ${from}`);
  const srcPath = g.tree.pathOf.get(src.id);
  const dest = cleanPath(to);
  if (!dest) throw httpError(400, 'destination required');
  if (dest === srcPath) return src;
  const parts = dest.split('/');
  const newName = parts.pop();
  const dirPath = parts.join('/');
  if (g.tree.byPath.has(dest)) throw httpError(409, `${dest} already exists`);
  if (dirPath === srcPath || dirPath.startsWith(srcPath + '/')) throw httpError(400, 'cannot move a folder into itself');
  const newParent = dirPath ? await ensureFolderPath(userId, projectId, dirPath, opts) : null;
  const curParent = g.tree.parentOf.get(src.id) || null;
  // Re-parent first so the rename's sibling check runs against the destination folder.
  if (newParent !== curParent) {
    if (newParent) await createEdge(userId, projectId, newParent, src.id, opts);
    else await unlinkNode(userId, src.id, opts);
  }
  if (newName !== src.name) await updateNode(userId, src.id, { name: newName, origin: opts.origin });
  return (await graphFor(userId, projectId)).tree.byId.get(src.id);
}

async function deletePath(userId, projectId, p, opts = {}) {
  const n = await nodeAtPath(userId, projectId, p);
  if (!n) throw httpError(404, `no such node: ${p}`);
  return deleteNode(userId, n.id, opts);
}

// Grep every text file. opts: { regex, glob, ignoreCase, maxResults }
async function search(userId, projectId, query, opts = {}) {
  if (!query) throw httpError(400, 'query required');
  const g = await graphFor(userId, projectId);
  let re;
  try {
    const src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(src, opts.ignoreCase ? 'i' : '');
  } catch (e) { throw httpError(400, 'bad regex: ' + e.message); }
  const globRe = opts.glob
    ? new RegExp('^' + String(opts.glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$')
    : null;
  const max = Math.min(Number(opts.maxResults) || 200, 2000);
  const ids = g.nodes.filter(n => n.kind === 'file' && !n.binary && (!globRe || globRe.test(g.tree.pathOf.get(n.id)))).map(n => n.id);
  const results = [];
  let truncated = false;
  // pull content in chunks to keep memory bounded
  for (let i = 0; i < ids.length && !truncated; i += 50) {
    const r = await q('SELECT id, content FROM nodes WHERE id = ANY($1::uuid[]) AND content IS NOT NULL', [ids.slice(i, i + 50)]);
    for (const row of r.rows) {
      const p = g.tree.pathOf.get(row.id);
      const lines = row.content.split('\n');
      for (let ln = 0; ln < lines.length; ln++) {
        if (re.test(lines[ln])) {
          results.push({ path: p, node_id: row.id, line: ln + 1, text: lines[ln].slice(0, 400) });
          if (results.length >= max) { truncated = true; break; }
        }
      }
      if (truncated) break;
    }
  }
  return { results, truncated, files_searched: ids.length };
}

module.exports = {
  NW, NH, LANGS, langFor, validName, cleanPath, events,
  ownProject, ownNode, publicNode, loadGraph, resolveTree, treeText, treeJson, freeSpot, placeNear,
  createNode, updateNode, deleteNode, createEdge, deleteEdge, unlinkNode,
  graphFor, nodeAtPath, ensureFolderPath, writeFileAtPath, createFolderAtPath, movePath, deletePath, search
};
