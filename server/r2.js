'use strict';
// Minimal S3-compatible client for Cloudflare R2 (put / get / delete / list)
// using SigV4 and Node's built-in fetch — no SDK. Configure with:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//   R2_ENDPOINT (optional; default https://<account>.r2.cloudflarestorage.com)
// Works against any S3 endpoint too (set R2_ENDPOINT + R2_REGION).
const crypto = require('crypto');

const cfg = {
  account: process.env.R2_ACCOUNT_ID || '',
  key: process.env.R2_ACCESS_KEY_ID || '',
  secret: process.env.R2_SECRET_ACCESS_KEY || '',
  bucket: process.env.R2_BUCKET || '',
  region: process.env.R2_REGION || 'auto',
  endpoint: (process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '')).replace(/\/+$/, '')
};
const enabled = () => !!(cfg.key && cfg.secret && cfg.bucket && cfg.endpoint);

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = p => p.split('/').map(enc).join('/');

function sign(method, key, query, body, extraHeaders) {
  const url = new URL(cfg.endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body || '');
  const canonicalUri = '/' + encPath(cfg.bucket) + (key ? '/' + encPath(key) : '');
  const canonicalQuery = Object.keys(query || {}).sort().map(k => enc(k) + '=' + enc(String(query[k]))).join('&');
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...(extraHeaders || {}) };
  const signedNames = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const canonicalHeaders = signedNames.map(h => h + ':' + String(headers[h] !== undefined ? headers[h] : headers[Object.keys(headers).find(k => k.toLowerCase() === h)]).trim() + '\n').join('');
  const signedHeaders = signedNames.join(';');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + cfg.secret, date), cfg.region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const target = cfg.endpoint + canonicalUri + (canonicalQuery ? '?' + canonicalQuery : '');
  return { url: target, headers };
}

async function request(method, key, { query, body, headers, expect } = {}) {
  const { url, headers: h } = sign(method, key, query, body, headers);
  const r = await fetch(url, { method, headers: h, body });
  if (!(expect || [200, 204]).includes(r.status)) {
    const text = await r.text().catch(() => '');
    const err = new Error(`r2 ${method} ${key || ''} -> ${r.status} ${text.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return r;
}

async function put(key, buf, contentType) {
  await request('PUT', key, { body: buf, headers: { 'content-type': contentType || 'application/octet-stream' } });
  return key;
}

async function get(key) {
  const r = await request('GET', key);
  return Buffer.from(await r.arrayBuffer());
}

async function exists(key) {
  try { await request('HEAD', key); return true; } catch (e) { if (e.status === 404) return false; throw e; }
}

async function del(key) {
  await request('DELETE', key, { expect: [200, 204, 404] });
}

async function list(prefix) {
  const keys = [];
  let token;
  do {
    const query = { 'list-type': '2', prefix };
    if (token) query['continuation-token'] = token;
    const r = await request('GET', '', { query });
    const xml = await r.text();
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    const t = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && t ? t[1] : null;
  } while (token);
  return keys;
}

async function deletePrefix(prefix) {
  const keys = await list(prefix);
  for (const k of keys) await del(k);
  return keys.length;
}

module.exports = { enabled, put, get, del, exists, list, deletePrefix, cfg };
