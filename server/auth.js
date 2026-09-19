'use strict';
// Email + password auth. Browser gets an httpOnly session cookie; the MCP
// server on the laptop uses a per-user bearer token. Both resolve to req.user.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const { q } = require('./db');
const { httpError, wrap } = require('./errors');

const COOKIE = 'quist_session';
const SESSION_DAYS = 30;
const TOKEN_PREFIX = 'qst_';

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const isEmail = s => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;

function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 86400 * 1000,
    path: '/'
  });
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  await q('INSERT INTO sessions(user_id, token, expires_at) VALUES ($1,$2,$3)', [userId, token, expires]);
  return token;
}

// Resolve the caller. Order: bearer API token, then session cookie.
async function resolveUser(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const raw = auth.slice(7).trim();
    if (!raw.startsWith(TOKEN_PREFIX)) return null;
    const r = await q(
      `SELECT u.id, u.email, t.id AS token_id FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1`,
      [sha256(raw)]
    );
    if (!r.rows.length) return null;
    q('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [r.rows[0].token_id]).catch(() => {});
    return { id: r.rows[0].id, email: r.rows[0].email, via: 'token' };
  }
  const tok = req.cookies && req.cookies[COOKIE];
  if (!tok) return null;
  const r = await q(
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()`,
    [tok]
  );
  if (!r.rows.length) return null;
  return { id: r.rows[0].id, email: r.rows[0].email, via: 'session' };
}

const requireAuth = wrap(async (req, res, next) => {
  const user = await resolveUser(req);
  if (!user) throw httpError(401, 'not signed in');
  req.user = user;
  next();
});

const router = express.Router();

router.post('/signup', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!isEmail(email)) throw httpError(400, 'enter a valid email');
  if (password.length < 8) throw httpError(400, 'password must be at least 8 characters');
  const hash = await bcrypt.hash(password, 11);
  let user;
  try {
    user = (await q('INSERT INTO users(email, password_hash) VALUES ($1,$2) RETURNING id, email', [email, hash])).rows[0];
  } catch (e) {
    if (e.code === '23505') throw httpError(409, 'that email already has an account');
    throw e;
  }
  setCookie(res, await createSession(user.id));
  res.status(201).json({ user });
}));

router.post('/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const r = await q('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
  const ok = r.rows.length && await bcrypt.compare(password, r.rows[0].password_hash);
  if (!ok) throw httpError(401, 'wrong email or password');
  setCookie(res, await createSession(r.rows[0].id));
  res.json({ user: { id: r.rows[0].id, email: r.rows[0].email } });
}));

router.post('/logout', wrap(async (req, res) => {
  const tok = req.cookies && req.cookies[COOKIE];
  if (tok) await q('DELETE FROM sessions WHERE token = $1', [tok]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

// ---- API tokens (for the MCP server) ----
const tokens = express.Router();
tokens.use(requireAuth);

tokens.get('/', wrap(async (req, res) => {
  const r = await q('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ tokens: r.rows });
}));

// The plaintext token is returned exactly once.
tokens.post('/', wrap(async (req, res) => {
  if (req.user.via !== 'session') throw httpError(403, 'create tokens from the browser session');
  const name = String(req.body.name || 'claude-code').slice(0, 64);
  const raw = TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
  const r = await q(
    'INSERT INTO api_tokens(user_id, name, token_hash, prefix) VALUES ($1,$2,$3,$4) RETURNING id, name, prefix, created_at',
    [req.user.id, name, sha256(raw), raw.slice(0, 12)]
  );
  res.status(201).json({ token: raw, ...r.rows[0] });
}));

tokens.delete('/:id', wrap(async (req, res) => {
  await q('DELETE FROM api_tokens WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

module.exports = { router, tokens, requireAuth, resolveUser, COOKIE };
