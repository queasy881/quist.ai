'use strict';
// Boots an embedded Postgres, sets DATABASE_URL, and starts the app on a random
// port. Used by every test file. Set QUIST_TEST_DB to reuse an external db.
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');

let pg = null;
let dataDir = null;

async function startPg() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quist-pgdata-'));
  const port = 45000 + Math.floor(Math.random() * 5000);
  pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'quist', password: 'quist', port, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('quist');
  const url = `postgres://quist:quist@localhost:${port}/quist`;
  process.env.DATABASE_URL = url;
  process.env.PGSSL = 'disable';
  return url;
}

async function stopPg() {
  if (pg) { try { await pg.stop(); } catch (_) {} }
  if (dataDir) { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {} }
}

let server, base;
async function startApp() {
  await startPg();
  process.env.WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'quist-ws-'));
  process.env.SANDBOX_DRIVER = 'local';
  process.env.NODE_ENV = 'test';
  const { app, main } = require('../server/index');
  // main() migrates + starts its own listener; we run the pieces we need here.
  const { migrate } = require('../server/db');
  await migrate();
  const sandbox = require('../server/sandbox');
  await sandbox.init();
  const terminal = require('../server/terminal');
  server = http.createServer(app);
  terminal.attach(server);
  await new Promise(r => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
  return base;
}

async function stopApp() {
  try { await require('../server/terminal').killAll(); } catch (_) {}
  try { await require('../server/workspace').disposeAll(); } catch (_) {}
  if (server) await new Promise(r => server.close(r));
  try { await require('../server/db').pool.end(); } catch (_) {}
  await stopPg();
}

// tiny cookie-aware fetch client
function client() {
  let cookie = '';
  let token = '';
  const jar = {
    async req(method, p, body, opts = {}) {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      if (token && opts.useToken) headers.Authorization = 'Bearer ' + token;
      const init = { method, headers };
      if (body instanceof Buffer) { init.body = body; }
      else if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      const r = await fetch(base + p, init);
      const setc = r.headers.get('set-cookie');
      if (setc) cookie = setc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      const data = ct.includes('json') ? await r.json().catch(() => ({})) : await r.arrayBuffer().then(b => Buffer.from(b));
      return { status: r.status, data };
    },
    get: (p, opts) => jar.req('GET', p, undefined, opts),
    post: (p, b, opts) => jar.req('POST', p, b, opts),
    patch: (p, b, opts) => jar.req('PATCH', p, b, opts),
    del: (p, b, opts) => jar.req('DELETE', p, b, opts),
    setToken: t => { token = t; },
    async postForm(p, form) {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      const r = await fetch(base + p, { method: 'POST', headers, body: form });
      const data = await r.json().catch(() => ({}));
      return { status: r.status, data };
    }
  };
  return jar;
}

module.exports = { startApp, stopApp, client, baseUrl: () => base };
