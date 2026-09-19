'use strict';
// Postgres pool + migrations. DATABASE_URL comes from Railway.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1|postgres\.railway\.internal/.test(connectionString) || process.env.PGSSL === 'disable'
    ? false
    : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10)
});

const q = (text, params) => pool.query(text, params);

// Run a callback inside a transaction with a dedicated client.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

// Apply server/migrations/*.sql in name order, once each.
async function migrate() {
  await q('CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set((await q('SELECT name FROM migrations')).rows.map(r => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await tx(async c => {
      await c.query(sql);
      await c.query('INSERT INTO migrations(name) VALUES ($1)', [f]);
    });
    console.log('[db] applied', f);
  }
}

module.exports = { pool, q, tx, migrate };
