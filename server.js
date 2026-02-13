require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ========== DATABASE ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS builds (
      id SERIAL PRIMARY KEY,
      type VARCHAR(20) NOT NULL,
      version VARCHAR(50) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      filedata BYTEA NOT NULL,
      filesize INTEGER NOT NULL,
      is_latest BOOLEAN DEFAULT false,
      changelog TEXT,
      uploaded_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS download_log (
      id SERIAL PRIMARY KEY,
      build_id INTEGER REFERENCES builds(id),
      ip VARCHAR(50),
      user_agent TEXT,
      downloaded_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Create default admin if none exists
  const admins = await pool.query('SELECT COUNT(*) FROM admin_users');
  if (parseInt(admins.rows[0].count) === 0) {
    const defaultUser = process.env.ADMIN_USERNAME || 'admin';
    const defaultPass = process.env.ADMIN_PASSWORD || 'admin';
    const hash = await bcrypt.hash(defaultPass, 10);
    await pool.query('INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)', [defaultUser, hash]);
    console.log(`[+] Default admin created: ${defaultUser} — set ADMIN_USERNAME and ADMIN_PASSWORD env vars`);
  }
  console.log('[+] Database initialized');
}

// ========== AUTH MIDDLEWARE ==========
// Simple session-based auth via token in header
const sessions = new Map();

function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.admin = sessions.get(token);
  next();
}

// ========== ADMIN AUTH ==========
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = require('crypto').randomBytes(32).toString('hex');
    sessions.set(token, { id: result.rows[0].id, username });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/change-password', authMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password too short' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [hash, req.admin.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== BUILD UPLOAD ==========
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

app.post('/api/admin/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const { type, version, changelog, setLatest } = req.body;
    if (!type || !version) return res.status(400).json({ error: 'type and version required' });
    if (!['internal', 'external'].includes(type)) return res.status(400).json({ error: 'type must be internal or external' });

    // If setting as latest, unset current latest of same type
    if (setLatest === 'true') {
      await pool.query('UPDATE builds SET is_latest = false WHERE type = $1', [type]);
    }

    const result = await pool.query(
      'INSERT INTO builds (type, version, filename, filedata, filesize, is_latest, changelog) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [type, version, req.file.originalname, req.file.buffer, req.file.size, setLatest === 'true', changelog || '']
    );

    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== BUILD MANAGEMENT ==========
app.get('/api/admin/builds', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, type, version, filename, filesize, is_latest, changelog, uploaded_at FROM builds ORDER BY uploaded_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/set-latest/:id', authMiddleware, async (req, res) => {
  try {
    const build = await pool.query('SELECT type FROM builds WHERE id = $1', [req.params.id]);
    if (build.rows.length === 0) return res.status(404).json({ error: 'Build not found' });

    await pool.query('UPDATE builds SET is_latest = false WHERE type = $1', [build.rows[0].type]);
    await pool.query('UPDATE builds SET is_latest = true WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/builds/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM builds WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download stats
app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM download_log');
    const today = await pool.query("SELECT COUNT(*) FROM download_log WHERE downloaded_at > NOW() - INTERVAL '24 hours'");
    const byType = await pool.query(`
      SELECT b.type, COUNT(*) as count FROM download_log dl
      JOIN builds b ON b.id = dl.build_id GROUP BY b.type
    `);
    res.json({
      totalDownloads: parseInt(total.rows[0].count),
      todayDownloads: parseInt(today.rows[0].count),
      byType: byType.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== PUBLIC ENDPOINTS (for launcher) ==========

// Version check
app.get('/api/version/:type', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, version, filesize, changelog, uploaded_at FROM builds WHERE type = $1 AND is_latest = true',
      [req.params.type]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No build available' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download latest build (for launcher)
app.get('/api/download/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (!['internal', 'external'].includes(type)) return res.status(400).send('Invalid type');

    const result = await pool.query(
      'SELECT id, filename, filedata, filesize FROM builds WHERE type = $1 AND is_latest = true',
      [type]
    );
    if (result.rows.length === 0) return res.status(404).send('No build available');

    const build = result.rows[0];

    // Log download
    await pool.query(
      'INSERT INTO download_log (build_id, ip, user_agent) VALUES ($1, $2, $3)',
      [build.id, req.ip, req.headers['user-agent'] || 'unknown']
    );

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${build.filename}"`);
    res.setHeader('Content-Length', build.filesize);
    res.setHeader('X-File-Size', build.filesize);
    res.send(build.filedata);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// ========== DEV PORTAL ==========
app.use('/dev', express.static(path.join(__dirname, 'public', 'dev')));

// ========== START ==========
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[+] Server running on port ${PORT}`);
    console.log(`[+] Dev portal: http://localhost:${PORT}/dev`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
