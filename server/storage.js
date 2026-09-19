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
const crypto = require('crypto');
const { q } = require('./db');
const r2 = require('./r2');

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
    if (isPointer(row.blob)) return await r2.get('blob/' + row.blob.toString('latin1').slice(3));
    return row.blob;
  }
  return Buffer.from(row.content || '', 'utf8');
}

// Read raw bytes + text for a node.
async function read(nodeId) {
  const r = await q('SELECT content, blob, size FROM nodes WHERE id = $1', [nodeId]);
  if (!r.rows.length) return null;
  const row = r.rows[0];
  const binary = !!row.blob;
  const buffer = await bytesFor(row);
  return { binary, buffer, content: binary ? null : (row.content !== null ? row.content : buffer.toString('utf8')), size: Number(row.size) };
}

// Read many files in one round trip. Text from Postgres is returned inline;
// R2-backed bytes are fetched per file.
async function readMany(nodeIds) {
  const r = await q('SELECT id, content, blob, size FROM nodes WHERE id = ANY($1::uuid[])', [nodeIds]);
  const out = new Map();
  for (const row of r.rows) {
    const binary = !!row.blob;
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

module.exports = { isBinary, prepare, prepareSync, read, readMany, stash, unstash, sha256, MAX_TEXT, USE_R2 };
