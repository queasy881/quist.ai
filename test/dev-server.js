// Boots embedded Postgres + the real app for local/manual testing.
const path = require('path'), os = require('os'), fs = require('fs');
(async () => {
  const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
  const dataDir = path.join(os.tmpdir(), 'quist-devpg');
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'quist', password: 'quist', port: 47654, persistent: true });
  try { await pg.initialise(); } catch (e) { /* already initialised */ }
  await pg.start();
  try { await pg.createDatabase('quist'); } catch (e) { /* exists */ }
  process.env.DATABASE_URL = 'postgres://quist:quist@localhost:47654/quist';
  process.env.PGSSL = 'disable';
  process.env.PORT = process.env.PORT || '3000';
  process.env.WORKSPACE_ROOT = path.join(os.tmpdir(), 'quist-devws');
  fs.mkdirSync(process.env.WORKSPACE_ROOT, { recursive: true });
  await require('../server/index').main();
  console.log('[dev] up on http://localhost:' + process.env.PORT);
  process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
})().catch(e => { console.error(e); process.exit(1); });
