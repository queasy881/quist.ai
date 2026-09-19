'use strict';
// Simulate the old quist-backend database (a `builds` table with `filedata`,
// plus admin_users/download_log) and confirm our migration heals it: the
// legacy tables go, our schema is created, and re-running is a no-op.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

let pg, dataDir, pool, migrate;

before(async () => {
  const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quist-legacy-'));
  const port = 46000 + Math.floor(Math.random() * 2000);
  pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'quist', password: 'quist', port, persistent: false });
  await pg.initialise(); await pg.start(); await pg.createDatabase('quist');
  process.env.DATABASE_URL = `postgres://quist:quist@localhost:${port}/quist`;
  process.env.PGSSL = 'disable';
  ({ pool, migrate } = require('../server/db'));
  // recreate the OLD app's schema
  await pool.query(`CREATE TABLE builds (
    id SERIAL PRIMARY KEY, type VARCHAR(20), version VARCHAR(50), filename VARCHAR(255),
    filedata BYTEA NOT NULL, filesize INTEGER, is_latest BOOLEAN DEFAULT false, changelog TEXT, uploaded_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE admin_users (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE, password_hash VARCHAR(255))`);
  await pool.query(`CREATE TABLE download_log (id SERIAL PRIMARY KEY, build_id INTEGER, ip VARCHAR(50))`);
  await pool.query(`INSERT INTO builds (filedata) VALUES ('\\x00'::bytea)`);
  // a foreign app's `users`/`projects` with an integer id — collides with our uuid schema
  await pool.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT)`);
  await pool.query(`CREATE TABLE projects (id SERIAL PRIMARY KEY, title TEXT)`);
  await pool.query(`INSERT INTO users (name) VALUES ('old-app-user')`);
});
after(async () => { try { await pool.end(); } catch (_) {} try { await pg.stop(); } catch (_) {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {} });

async function colExists(table, col) {
  const r = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [table, col]);
  return r.rows.length > 0;
}
async function tableExists(table) {
  const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name=$1`, [table]);
  return r.rows.length > 0;
}

test('migration heals a legacy database', async () => {
  assert.ok(await colExists('builds', 'filedata'), 'precondition: legacy builds present');
  await migrate();
  // legacy gone
  assert.equal(await colExists('builds', 'filedata'), false, 'legacy filedata column removed');
  assert.equal(await tableExists('admin_users'), false);
  assert.equal(await tableExists('download_log'), false);
  // ours created
  assert.ok(await colExists('builds', 'toolchain'), 'our builds.toolchain exists');
  assert.ok(await tableExists('users'));
  assert.ok(await tableExists('nodes'));
  assert.ok(await tableExists('edges'));
  // the colliding foreign users/projects were replaced with our uuid schema
  const idType = (await pool.query(`SELECT data_type FROM information_schema.columns WHERE table_name='users' AND column_name='id'`)).rows[0].data_type;
  assert.equal(idType, 'uuid', 'users.id is our uuid, not the legacy integer');
  assert.ok(await colExists('projects', 'mcp_disabled'), 'our projects schema replaced the legacy one');
  // the FK that previously failed now works
  const u = await pool.query(`INSERT INTO users(email, password_hash) VALUES ('x@y.z','h') RETURNING id`);
  await pool.query(`INSERT INTO sessions(user_id, token, expires_at) VALUES ($1,'t', now() + interval '1 day')`, [u.rows[0].id]);
});

test('re-running migrate is a no-op and keeps our builds table', async () => {
  await migrate();
  assert.ok(await colExists('builds', 'toolchain'), 'our builds survives a second migrate');
  assert.equal(await colExists('builds', 'filedata'), false);
});
