'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startApp, stopApp, client } = require('./helper');

let A, B; // two users

before(async () => {
  await startApp();
  A = client(); B = client();
  await A.post('/api/auth/signup', { email: 'a@quist.dev', password: 'password123' });
  await B.post('/api/auth/signup', { email: 'b@quist.dev', password: 'password123' });
});
after(stopApp);

async function project(c, name) { const r = await c.post('/api/projects', { name }); return r.data.project; }
async function node(c, pid, body) { const r = await c.post(`/api/projects/${pid}/nodes`, body); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.node; }

test('signup created a session and /api/me works', async () => {
  const r = await A.get('/api/me');
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, 'a@quist.dev');
});

test('duplicate email is rejected', async () => {
  const c = client();
  const r = await c.post('/api/auth/signup', { email: 'a@quist.dev', password: 'password123' });
  assert.equal(r.status, 409);
});

test('only a folder can own a node', async () => {
  const p = await project(A, 'own');
  const file = await node(A, p.id, { kind: 'file', name: 'a.txt' });
  const other = await node(A, p.id, { kind: 'file', name: 'b.txt' });
  const r = await A.post(`/api/projects/${p.id}/edges`, { from: file.id, to: other.id });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /folder/i);
});

test('a node has at most one owner; re-linking moves it', async () => {
  const p = await project(A, 'oneowner');
  const f1 = await node(A, p.id, { kind: 'folder', name: 'f1' });
  const f2 = await node(A, p.id, { kind: 'folder', name: 'f2' });
  const file = await node(A, p.id, { kind: 'file', name: 'x.ts' });
  const e1 = await A.post(`/api/projects/${p.id}/edges`, { from: f1.id, to: file.id });
  assert.equal(e1.status, 201);
  const e2 = await A.post(`/api/projects/${p.id}/edges`, { from: f2.id, to: file.id });
  assert.equal(e2.status, 201);
  const g = await A.get(`/api/projects/${p.id}`);
  const owners = g.data.edges.filter(e => e.to === file.id);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].from, f2.id);
});

test('a cycle is refused', async () => {
  const p = await project(A, 'cycle');
  const a = await node(A, p.id, { kind: 'folder', name: 'a' });
  const b = await node(A, p.id, { kind: 'folder', name: 'b' });
  await A.post(`/api/projects/${p.id}/edges`, { from: a.id, to: b.id }); // a owns b
  const r = await A.post(`/api/projects/${p.id}/edges`, { from: b.id, to: a.id }); // b owns a -> cycle
  assert.equal(r.status, 400);
  assert.match(r.data.error, /cycle/i);
});

test('deleting a folder orphans children; cascade removes them', async () => {
  const p = await project(A, 'del');
  const dir = await node(A, p.id, { kind: 'folder', name: 'dir' });
  const child = await node(A, p.id, { kind: 'file', name: 'c.txt' });
  await A.post(`/api/projects/${p.id}/edges`, { from: dir.id, to: child.id });
  // non-cascade: child survives as a root
  const d1 = await A.del(`/api/nodes/${dir.id}`);
  assert.equal(d1.status, 200);
  let g = await A.get(`/api/projects/${p.id}`);
  assert.ok(g.data.nodes.find(n => n.id === child.id), 'child should survive');
  assert.equal(g.data.edges.length, 0);
  // cascade
  const dir2 = await node(A, p.id, { kind: 'folder', name: 'dir2' });
  await A.post(`/api/projects/${p.id}/edges`, { from: dir2.id, to: child.id });
  const d2 = await A.del(`/api/nodes/${dir2.id}?cascade=1`);
  assert.deepEqual(d2.data.removed.sort(), [dir2.id, child.id].sort());
  g = await A.get(`/api/projects/${p.id}`);
  assert.equal(g.data.nodes.length, 0);
});

test('tenant isolation: B cannot read or mutate A\'s project', async () => {
  const p = await project(A, 'secret');
  await node(A, p.id, { kind: 'file', name: 'secret.txt', content: 'classified' });
  const r1 = await B.get(`/api/projects/${p.id}`);
  assert.equal(r1.status, 404);
  const r2 = await B.post(`/api/projects/${p.id}/nodes`, { kind: 'file', name: 'evil.txt' });
  assert.equal(r2.status, 404);
});

test('unauthenticated requests are 401', async () => {
  const c = client();
  const r = await c.get('/api/projects');
  assert.equal(r.status, 401);
});

test('path-based write creates folders, tree resolves, search finds text', async () => {
  const p = await project(A, 'paths');
  const w = await A.post(`/api/projects/${p.id}/files`, { path: 'src/util/math.ts', content: 'export const add = (a,b) => a+b; // TODO tune\n' });
  assert.equal(w.status, 201);
  const tree = await A.get(`/api/projects/${p.id}/tree?text=1`);
  assert.match(tree.data.text, /src/);
  assert.match(tree.data.text, /math\.ts/);
  const search = await A.get(`/api/projects/${p.id}/search?q=TODO`);
  assert.equal(search.data.results.length, 1);
  assert.equal(search.data.results[0].path, 'src/util/math.ts');
  const read = await A.get(`/api/projects/${p.id}/files?path=src/util/math.ts`);
  assert.match(read.data.content, /add/);
});

test('edit_file string replace enforces uniqueness', async () => {
  const p = await project(A, 'edit');
  await A.post(`/api/projects/${p.id}/files`, { path: 'a.txt', content: 'foo foo bar' });
  const bad = await A.post(`/api/projects/${p.id}/files/edit`, { path: 'a.txt', old_string: 'foo', new_string: 'baz' });
  assert.equal(bad.status, 409);
  const good = await A.post(`/api/projects/${p.id}/files/edit`, { path: 'a.txt', old_string: 'foo', new_string: 'baz', replace_all: true });
  assert.equal(good.status, 200);
  const read = await A.get(`/api/projects/${p.id}/files?path=a.txt`);
  assert.equal(read.data.content, 'baz baz bar');
});

test('move re-parents a node in the tree', async () => {
  const p = await project(A, 'move');
  await A.post(`/api/projects/${p.id}/files`, { path: 'old/x.txt', content: 'hi' });
  const mv = await A.post(`/api/projects/${p.id}/files/move`, { from: 'old/x.txt', to: 'new/deep/y.txt' });
  assert.equal(mv.status, 200);
  const read = await A.get(`/api/projects/${p.id}/files?path=new/deep/y.txt`);
  assert.equal(read.data.content, 'hi');
  const gone = await A.get(`/api/projects/${p.id}/files?path=old/x.txt`);
  assert.equal(gone.status, 404);
});

test('versions snapshot and revert restore file contents', async () => {
  const p = await project(A, 'ver');
  await A.post(`/api/projects/${p.id}/files`, { path: 'v.txt', content: 'one' });
  const snap = await A.post(`/api/projects/${p.id}/versions`, { label: 'v1' });
  assert.equal(snap.status, 201);
  await A.post(`/api/projects/${p.id}/files`, { path: 'v.txt', content: 'two' });
  await A.post(`/api/projects/${p.id}/files`, { path: 'extra.txt', content: 'added later' });
  const rev = await A.post(`/api/versions/${snap.data.version.id}/revert`);
  assert.equal(rev.status, 200);
  const read = await A.get(`/api/projects/${p.id}/files?path=v.txt`);
  assert.equal(read.data.content, 'one');
  const extra = await A.get(`/api/projects/${p.id}/files?path=extra.txt`);
  assert.equal(extra.status, 404, 'files added after the snapshot are gone after revert');
});

test('bulk import creates a big tree in one call with folders resolved', async () => {
  const p = await project(A, 'bulk');
  const files = [];
  for (let i = 0; i < 400; i++) files.push({ path: `src/mod${i % 8}/file${i}.ts`, content: `export const x${i} = ${i}; // TODO${i}` });
  files.push({ path: 'README.md', content: '# bulk' });
  const t0 = Date.now();
  const r = await A.post(`/api/projects/${p.id}/files/bulk`, { files });
  const ms = Date.now() - t0;
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.created, 401);
  assert.equal(r.data.folders, 9); // src + src/mod0..7
  // graph is consistent: 410 nodes, every file owned, no cycles
  const g = await A.get(`/api/projects/${p.id}`);
  assert.equal(g.data.nodes.length, 410);
  const tree = await A.get(`/api/projects/${p.id}/tree?path=src/mod3`);
  assert.ok(tree.data.tree.length > 0);
  // re-importing the same paths updates in place, doesn't duplicate
  const r2 = await A.post(`/api/projects/${p.id}/files/bulk`, { files: [{ path: 'src/mod3/file3.ts', content: 'updated' }] });
  assert.equal(r2.data.updated, 1);
  const read = await A.get(`/api/projects/${p.id}/files?path=src/mod3/file3.ts`);
  assert.equal(read.data.content, 'updated');
  const g2 = await A.get(`/api/projects/${p.id}`);
  assert.equal(g2.data.nodes.length, 410, 'no duplicate nodes on re-import');
  assert.ok(ms < 8000, 'bulk import of 400 files took ' + ms + 'ms');
});

test('binary upload is stored and downloadable byte-for-byte', async () => {
  const p = await project(A, 'bin');
  const bytes = Buffer.from([0, 1, 2, 3, 255, 254, 0, 66]);
  const form = new FormData();
  form.append('files', new Blob([bytes]), 'blob.bin');
  const r = await A.postForm(`/api/projects/${p.id}/upload`, form);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.created, 1);
  const g = await A.get(`/api/projects/${p.id}`);
  const node = g.data.nodes.find(n => n.name === 'blob.bin');
  assert.ok(node && node.binary, 'binary node created');
  const dl = await A.get(`/api/nodes/${node.id}/download`);
  assert.deepEqual(Buffer.from(dl.data), bytes);
});
