'use strict';
// Quist.ai server: Express API + static UI + WebSocket terminal/build streams.
require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const { migrate } = require('./db');
const auth = require('./auth');
const routes = require('./routes');
const ctl = require('./ctl');
const terminal = require('./terminal');
const builds = require('./builds');
const sandbox = require('./sandbox');
const storage = require('./storage');
const { HttpError, pgToHttp } = require('./errors');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, '..', 'public');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: process.env.JSON_LIMIT || '64mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// Health: ok=true means the process is up (so the platform keeps the deploy).
// db reflects whether migrations succeeded; the UI/API need db=true to work.
const health = { db: false, dbError: null };
app.get('/healthz', (req, res) => res.json({ ok: true, db: health.db, dbError: health.dbError, driver: sandbox.getDriver(), pty: sandbox.hasPty() }));

app.use('/api/auth', auth.router);
app.use('/api/tokens', auth.tokens);
app.use('/api', routes);
app.use('/ctl', ctl);

// Pages. The app shell redirects to /login itself when /api/me is 401.
app.use(express.static(PUBLIC, { extensions: ['html'], index: 'index.html', maxAge: '1h',
  setHeaders: (res, p) => { if (/\.(html|jsx)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get(['/login', '/signup'], (req, res) => res.sendFile(path.join(PUBLIC, req.path.slice(1) + '.html')));
app.get('/p/:id', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'no such route' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const e = pgToHttp(err);
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  if (e && e.type === 'entity.too.large') return res.status(413).json({ error: 'payload too large' });
  if (e && e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file too large' });
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

// Node reports some connection failures (e.g. refused on every address) as an AggregateError with
// an empty message; spell out the codes so /healthz and the logs say what happened.
function errText(e) {
  if (!e) return 'unknown error';
  if (e.message) return e.message;
  const inner = Array.isArray(e.errors) ? e.errors.map(x => x && (x.message || x.code)).filter(Boolean) : [];
  return inner.length ? inner.join('; ') : (e.code || String(e));
}

async function main() {
  // Bind first so the platform health check passes and logs are reachable even
  // if the database is misconfigured; then migrate and start the workers.
  const server = http.createServer(app);
  terminal.attach(server);
  await new Promise(r => server.listen(PORT, r));
  console.log(`[quist] listening on :${PORT}`);

  await sandbox.init();
  // Keep trying: Postgres may still be starting (or restarting) when we boot. Without the retry one
  // refused connection left the API 5xx-ing until the next redeploy.
  const dbUp = async () => {
    health.db = true;
    health.dbError = null;
    console.log('[quist] database ready');
    storage.pruneParts().catch(e => console.error('[storage] prune:', errText(e)));
    try { await builds.startWorker(); } catch (e) { console.error('[quist] build worker:', errText(e)); }
  };
  const tryDb = async attempt => {
    try {
      await migrate();
      await dbUp();
    } catch (e) {
      health.dbError = errText(e);
      if (attempt === 1) console.error('[quist] DATABASE NOT READY — the API will 5xx until it is (retrying every 5 s):\n   ', health.dbError);
      else if (attempt % 12 === 0) console.error('[quist] still no database after', attempt, 'tries:', health.dbError);
      setTimeout(() => tryDb(attempt + 1), 5000);
    }
  };
  await tryDb(1);
  // Docker driver: containers have no network, so built-ins reach us over a unix socket.
  if (sandbox.getDriver() === 'docker' && process.platform !== 'win32') {
    try { fs.unlinkSync(sandbox.CTL_SOCK); } catch (_) { /* none */ }
    const ctlServer = http.createServer(app);
    ctlServer.listen(sandbox.CTL_SOCK, () => { fs.chmodSync(sandbox.CTL_SOCK, 0o666); console.log('[quist] ctl socket at', sandbox.CTL_SOCK); });
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { app, main };
