'use strict';
// Versions: a snapshot is a full copy of nodes + edges. Reverting replaces the
// whole graph with the snapshot (same node ids), then re-materialises any live
// workspace from the DB.
const { q, tx } = require('./db');
const { httpError } = require('./errors');
const graph = require('./graph');
const storage = require('./storage');

const publicVersion = v => ({ id: v.id, project_id: v.project_id, label: v.label, created_at: v.created_at,
  files: v.snapshot ? v.snapshot.nodes.filter(n => n.kind === 'file').length : v.files, nodes: v.snapshot ? v.snapshot.nodes.length : v.nodes });

async function list(userId, projectId) {
  await graph.ownProject(userId, projectId);
  const r = await q(`SELECT id, project_id, label, created_at,
      (SELECT count(*) FROM jsonb_array_elements(snapshot->'nodes') n WHERE n->>'kind' = 'file') AS files,
      jsonb_array_length(snapshot->'nodes') AS nodes
    FROM versions WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
  return r.rows.map(v => ({ ...v, files: Number(v.files), nodes: Number(v.nodes) }));
}

async function snapshot(userId, projectId, label) {
  await graph.ownProject(userId, projectId);
  return tx(async c => {
    const count = await c.query('SELECT count(*) FROM versions WHERE project_id = $1', [projectId]);
    const lbl = String(label || '').trim() || ('v0.0.' + (Number(count.rows[0].count) + 1));
    const nodes = await c.query('SELECT id, kind, name, x, y, lang, size, content, blob FROM nodes WHERE project_id = $1 ORDER BY created_at', [projectId]);
    const edges = await c.query('SELECT id, from_node AS "from", to_node AS "to" FROM edges WHERE project_id = $1 ORDER BY created_at', [projectId]);
    const snapNodes = [];
    for (const n of nodes.rows) {
      const s = { id: n.id, kind: n.kind, name: n.name, x: n.x, y: n.y, lang: n.lang, size: Number(n.size) };
      if (n.kind === 'file') {
        if (n.blob) {
          // n.blob is either raw bytes (PG backend) or an r2:<sha> pointer.
          const bytes = await storage.read(n.id);
          s.blob_sha = await storage.stash(bytes.buffer);
        } else s.content = n.content || '';
      }
      snapNodes.push(s);
    }
    const r = await c.query('INSERT INTO versions(project_id, label, snapshot) VALUES ($1,$2,$3) RETURNING id, project_id, label, created_at',
      [projectId, lbl, JSON.stringify({ nodes: snapNodes, edges: edges.rows })]);
    return { ...r.rows[0], files: snapNodes.filter(n => n.kind === 'file').length, nodes: snapNodes.length };
  });
}

async function get(userId, versionId) {
  const r = await q('SELECT v.* FROM versions v JOIN projects p ON p.id = v.project_id WHERE v.id = $1 AND p.user_id = $2', [versionId, userId]);
  if (!r.rows.length) throw httpError(404, 'no such version');
  return r.rows[0];
}

// Replace the project graph with the snapshot.
async function revert(userId, versionId) {
  const v = await get(userId, versionId);
  const snap = v.snapshot;
  await tx(async c => {
    await c.query('DELETE FROM nodes WHERE project_id = $1', [v.project_id]);
    for (const n of snap.nodes) {
      let blob = null, content = null, size = n.size || 0;
      if (n.kind === 'file') {
        if (n.blob_sha) {
          const bytes = await storage.unstash(n.blob_sha);
          const stored = await storage.prepare(bytes); // re-offloads to R2 if that's the backend
          content = stored.content; blob = stored.blob; size = stored.size;
        } else {
          const stored = await storage.prepare(n.content || '');
          content = stored.content; blob = stored.blob; size = stored.size;
        }
      }
      await c.query(
        'INSERT INTO nodes(id, project_id, kind, name, x, y, content, blob, lang, size) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [n.id, v.project_id, n.kind, n.name, n.x, n.y, content, blob, n.lang, size]);
    }
    for (const e of snap.edges) {
      await c.query('INSERT INTO edges(project_id, from_node, to_node) VALUES ($1,$2,$3)', [v.project_id, e.from, e.to]);
    }
    await c.query('UPDATE projects SET updated_at = now() WHERE id = $1', [v.project_id]);
  });
  graph.events.emit('graph', { projectId: v.project_id, type: 'graph.replaced', origin: 'api', label: v.label });
  return publicVersion(v);
}

async function remove(userId, versionId) {
  const v = await get(userId, versionId);
  await q('DELETE FROM versions WHERE id = $1', [v.id]);
  return { ok: true };
}

module.exports = { list, snapshot, get, revert, remove, publicVersion };
