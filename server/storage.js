'use strict';
// Content storage seam. Two backends, chosen by env at startup:
//
//   Postgres (default): text in nodes.content, binary in nodes.blob.
//   R2 / S3 (when R2_* env is set): text still in nodes.content (cheap, greppable);
//     binary bytes go to the bucket under blob/<sha256>, and nodes.blob holds a
//     small pointer buffer `r2:<sha>`. Content-addressed, so identical bytes are
//     stored once. Flip STORAGE_TEXT_IN_R2=1 to push large text out too.
//
// Nothing outside this file reads nodes.content/blob directly, so switching
// backends is a config change, not a code change.
//   Parted (any backend): big files from chunked uploads are written as <= 8 MB rows in
//     blob_parts and nodes.blob holds a pointer `pgp:<id>`. They are streamed in and out and
//     never loaded whole - read() refuses them, download streams them.
const crypto = require('crypto');
const fs = require('fs');
const { once } = require('events');
const { q } = require('./db');
const r2 = require('./r2');
const { httpError } = require('./errors');

const PART_BYTES = 8 * 1024 * 1024;
const PARTS = /^pgp:([0-9a-f-]{36})$/;
const partsId = buf => (Buffer.isBuffer(buf) && buf.length === 40 && PARTS.test(buf.toString('latin1')) ? buf.toString('latin1').slice(4) : null);

const MAX_TEXT = Number(process.env.MAX_TEXT_BYTES || 8 * 1024 * 1024);
const USE_R2 = r2.enabled();
const R2_TEXT = USE_R2 && process.env.STORAGE_TEXT_IN_R2 === '1';
const R2_TEXT_MIN = Number(process.env.R2_TEXT_MIN_BYTES || 256 * 1024); // only offload big text
const PTR = /^r2:([0-9a-f]{64})$/;

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const pointer = sha => Buffer.from('r2:' + sha);
const isPointer = buf => Buffer.isBuffer(buf) && buf.length === 67 && PTR.test(buf.toString('latin1'));

if (USE_R2) console.log('[storage] R2 bucket', r2.cfg.bucket, R2_TEXT ? '(text + binary)' : '(binary offload)');
else console.log('[storage] Postgres (set R2_* env to offload blobs)');

// NUL byte in the first 8k, or invalid UTF-8 => binary.
function isBinary(buf) {
  const head = buf.subarray(0, 8000);
  if (head.includes(0)) return true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return false; } catch (_) { return true; }
}

// Push bytes to R2 (content-addressed) and return the pointer buffer.
async function offload(buf) {
  const sha = sha256(buf);
  if (!(await r2.exists('blob/' + sha))) await r2.put('blob/' + sha, buf);
  return pointer(sha);
}

// Normalise incoming content into a row shape { content, blob, size }.
// With R2 this may perform an upload, so it is async.
async function prepare(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input == null ? '' : input), 'utf8');
  const size = buf.length;
  const binary = Buffer.isBuffer(input) ? (isBinary(buf) || size > MAX_TEXT) : false;
  if (binary) {
    if (USE_R2) return { content: null, blob: await offload(buf), size };
    return { content: null, blob: buf, size };
  }
  const text = buf.toString('utf8');
  if (R2_TEXT && size >= R2_TEXT_MIN) return { content: null, blob: await offload(buf), size };
  return { content: text, blob: null, size };
}

// Synchronous prepare for callers that cannot await (rare). Postgres only.
function prepareSync(input) {
  if (USE_R2) throw new Error('storage.prepareSync unavailable with R2 backend');
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input == null ? '' : input), 'utf8');
  const binary = Buffer.isBuffer(input) && (isBinary(buf) || buf.length > MAX_TEXT);
  return binary ? { content: null, blob: buf, size: buf.length } : { content: buf.toString('utf8'), blob: null, size: buf.length };
}

async function bytesFor(row) {
  if (row.blob) {
    if (partsId(row.blob)) throw httpError(413, `file is too large to load (${Math.round(Number(row.size) / 1048576)} MB) - download it instead`);
    if (isPointer(row.blob)) return await r2.get('blob/' + row.blob.toString('latin1').slice(3));
    return row.blob;
  }
  return Buffer.from(row.content || '', 'utf8');
}

// Read raw bytes + text for a node. opts.metaOnly: for binary nodes, don't load the bytes (buffer: null).
async function read(nodeId, opts = {}) {
  const r = await q('SELECT content, blob, size FROM nodes WHERE id = $1', [nodeId]);
  if (!r.rows.length) return null;
  const row = r.rows[0];
  const binary = !!row.blob;
  if (binary && opts.metaOnly) return { binary, buffer: null, content: null, size: Number(row.size) };
  const buffer = await bytesFor(row);
  return { binary, buffer, content: binary ? null : (row.content !== null ? row.content : buffer.toString('utf8')), size: Number(row.size) };
}

// Is this node's content stored in parts (too big to load whole)?
async function isParted(nodeId) {
  const r = await q('SELECT blob FROM nodes WHERE id = $1', [nodeId]);
  return !!(r.rows.length && partsId(r.rows[0].blob));
}

// Store a file from disk as parts, a piece at a time. Returns a row shape for createNodesBulk.
async function storeFileParts(filePath) {
  const id = crypto.randomUUID();
  const fh = await fs.promises.open(filePath, 'r');
  const buf = Buffer.alloc(PART_BYTES);
  let size = 0;
  try {
    for (let idx = 0; ; idx++) {
      const { bytesRead } = await fh.read(buf, 0, PART_BYTES, size);
      if (!bytesRead) break;
      await q('INSERT INTO blob_parts(id, idx, data) VALUES ($1,$2,$3)', [id, idx, Buffer.from(buf.subarray(0, bytesRead))]);
      size += bytesRead;
    }
  } catch (e) {
    await q('DELETE FROM blob_parts WHERE id = $1', [id]).catch(() => {});
    throw e;
  } finally {
    await fh.close();
  }
  return { content: null, blob: Buffer.from('pgp:' + id, 'latin1'), size };
}

// Drop parts no node or version snapshot points at any more (deleted files). Run at startup only,
// when no upload can be half-way through writing its parts.
async function pruneParts() {
  const r = await q(`DELETE FROM blob_parts bp
    WHERE NOT EXISTS (SELECT 1 FROM nodes n WHERE n.blob = convert_to('pgp:' || bp.id::text, 'UTF8'))
      AND NOT EXISTS (SELECT 1 FROM versions v WHERE strpos(v.snapshot::text, 'pgp:' || bp.id::text) > 0)`);
  if (r.rowCount) console.log('[storage] pruned', r.rowCount, 'orphaned blob parts');
}

// Send a node's bytes to an HTTP response; parts are streamed one at a time (with backpressure).
async function pipeTo(nodeId, res) {
  const r = await q('SELECT content, blob, size FROM nodes WHERE id = $1', [nodeId]);
  if (!r.rows.length) { res.end(); return; }
  const row = r.rows[0];
  const id = partsId(row.blob);
  if (!id) { res.end(await bytesFor(row)); return; }
  res.setHeader('Content-Length', String(row.size));
  for (let idx = 0; ; idx++) {
    const p = await q('SELECT data FROM blob_parts WHERE id = $1 AND idx = $2', [id, idx]);
    if (!p.rows.length) break;
    if (!res.write(p.rows[0].data)) await once(res, 'drain');
  }
  res.end();
}

// Read many files in one round trip. Text from Postgres is returned inline;
// R2-backed bytes are fetched per file.
async function readMany(nodeIds) {
  const r = await q('SELECT id, content, blob, size FROM nodes WHERE id = ANY($1::uuid[])', [nodeIds]);
  const out = new Map();
  for (const row of r.rows) {
    const binary = !!row.blob;
    if (binary && partsId(row.blob)) { out.set(row.id, { binary: true, content: null, size: Number(row.size) }); continue; }
    if (binary) {
      const buf = await bytesFor(row);
      const bin = isBinary(buf);
      out.set(row.id, { binary: bin, content: bin ? null : buf.toString('utf8'), size: Number(row.size) });
    } else {
      out.set(row.id, { binary: false, content: row.content || '', size: Number(row.size) });
    }
  }
  return out;
}

// Content-address a buffer for version snapshots (used by versions.js).
async function stash(buf) {
  const sha = sha256(buf);
  if (USE_R2) { if (!(await r2.exists('blob/' + sha))) await r2.put('blob/' + sha, buf); }
  else await q('INSERT INTO blobs(sha256, data) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sha, buf]);
  return sha;
}
async function unstash(sha) {
  if (USE_R2) return await r2.get('blob/' + sha);
  const r = await q('SELECT data FROM blobs WHERE sha256 = $1', [sha]);
  return r.rows.length ? r.rows[0].data : Buffer.alloc(0);
}

module.exports = { isBinary, prepare, prepareSync, read, readMany, stash, unstash, sha256, MAX_TEXT, USE_R2,
  partsId, isParted, storeFileParts, pipeTo, pruneParts, PART_BYTES };
