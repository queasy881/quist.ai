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
const { HttpError, pgToHttp } = require('./errors');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, '..', 'public');
const MCP_FILE = path.join(__dirname, '..', 'mcp', 'quist-mcp.js');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: process.env.JSON_LIMIT || '64mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

app.get('/healthz', (req, res) => res.json({ ok: true, driver: sandbox.getDriver(), pty: sandbox.hasPty() }));

app.use('/api/auth', auth.router);
app.use('/api/tokens', auth.tokens);
app.use('/api', routes);
app.use('/ctl', ctl);

// The MCP server is a single dependency-free file; the app serves it so the
// "Connect Claude Code" panel can hand it out.
app.get('/quist-mcp.js', (req, res) => { res.type('application/javascript'); res.sendFile(MCP_FILE); });

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

async function main() {
  await migrate();
  await sandbox.init();
  const server = http.createServer(app);
  terminal.attach(server);
  await builds.startWorker();
  server.listen(PORT, () => console.log(`[quist] listening on :${PORT}`));
  // Docker driver: containers have no network, so built-ins reach us over a unix socket.
  if (sandbox.getDriver() === 'docker' && process.platform !== 'win32') {
    try { fs.unlinkSync(sandbox.CTL_SOCK); } catch (_) { /* none */ }
    const ctlServer = http.createServer(app);
    ctlServer.listen(sandbox.CTL_SOCK, () => { fs.chmodSync(sandbox.CTL_SOCK, 0o666); console.log('[quist] ctl socket at', sandbox.CTL_SOCK); });
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { app, main };
