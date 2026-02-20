require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Pool } = require('pg');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Init DB
async function initDB() {
    try {
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await pool.query(schema);
        console.log('DB initialized');
    } catch (e) { console.error('DB init error:', e.message); }
}
initDB();

app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// ══════════════ AUTH ══════════════
const sessions = new Map();

function auth(req, res, next) {
    const token = req.cookies.session || req.headers['x-session-token'];
    if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Not authenticated' });
    req.userId = sessions.get(token);
    next();
}

const COLORS = ['#5865F2', '#EB459E', '#57F287', '#FEE75C', '#ED4245', '#9B59B6', '#E67E22', '#1ABC9C', '#E91E63', '#3498DB'];

app.post('/api/register', async (req, res) => {
    try {
        const { username, displayName, password } = req.body;
        if (!username || !password || !displayName) return res.status(400).json({ error: 'All fields required' });
        if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });
        const hash = await bcrypt.hash(password, 10);
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        const r = await pool.query(
            'INSERT INTO users (username, display_name, password_hash, avatar_color) VALUES ($1,$2,$3,$4) RETURNING id, username, display_name, avatar_color, status',
            [username.toLowerCase().trim(), displayName.trim(), hash, color]
        );
        const user = r.rows[0];
        const token = uuidv4();
        sessions.set(token, user.id);
        res.cookie('session', token, { httpOnly: true, maxAge: 30 * 86400000 });
        res.json({ user: formatUser(user), token });
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'Username taken' });
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const r = await pool.query('SELECT * FROM users WHERE username=$1', [username.toLowerCase().trim()]);
        if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
        const user = r.rows[0];
        if (!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
        const token = uuidv4();
        sessions.set(token, user.id);
        res.cookie('session', token, { httpOnly: true, maxAge: 30 * 86400000 });
        res.json({ user: formatUser(user), token });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
    const t = req.cookies.session;
    if (t) sessions.delete(t);
    res.clearCookie('session').json({ ok: true });
});

app.get('/api/me', auth, async (req, res) => {
    try {
        const r = await pool.query('SELECT id, username, display_name, avatar_color, status, custom_status FROM users WHERE id=$1', [req.userId]);
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(formatUser(r.rows[0]));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/me/status', auth, async (req, res) => {
    try {
        const { status, customStatus } = req.body;
        await pool.query('UPDATE users SET status=$1, custom_status=$2 WHERE id=$3', [status || 'online', customStatus || '', req.userId]);
        broadcastPresence(req.userId, status || 'online');
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

function formatUser(u) {
    return { id: u.id, username: u.username, displayName: u.display_name, avatarColor: u.avatar_color, status: u.status || 'online', customStatus: u.custom_status || '' };
}

// ══════════════ FRIENDS ══════════════
app.post('/api/friends/request', auth, async (req, res) => {
    try {
        const { username } = req.body;
        const target = await pool.query('SELECT id FROM users WHERE username=$1', [username.toLowerCase().trim()]);
        if (!target.rows.length) return res.status(404).json({ error: 'User not found' });
        const targetId = target.rows[0].id;
        if (targetId === req.userId) return res.status(400).json({ error: "Can't friend yourself" });

        // Check if already exists
        const existing = await pool.query(
            'SELECT * FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)',
            [req.userId, targetId]
        );
        if (existing.rows.length) {
            const f = existing.rows[0];
            if (f.status === 'accepted') return res.status(400).json({ error: 'Already friends' });
            if (f.status === 'pending') return res.status(400).json({ error: 'Request already sent' });
        }

        await pool.query('INSERT INTO friendships (requester_id, addressee_id) VALUES ($1,$2)', [req.userId, targetId]);
        notifyUser(targetId, { type: 'friend_request', from: req.userId });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/friends/accept', auth, async (req, res) => {
    try {
        const { userId } = req.body;
        await pool.query(
            "UPDATE friendships SET status='accepted' WHERE requester_id=$1 AND addressee_id=$2 AND status='pending'",
            [userId, req.userId]
        );
        notifyUser(userId, { type: 'friend_accepted', from: req.userId });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/friends/decline', auth, async (req, res) => {
    try {
        const { userId } = req.body;
        await pool.query('DELETE FROM friendships WHERE requester_id=$1 AND addressee_id=$2', [userId, req.userId]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/friends/remove', auth, async (req, res) => {
    try {
        const { userId } = req.body;
        await pool.query(
            'DELETE FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)',
            [req.userId, userId]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/friends', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, f.status as friend_status,
                   CASE WHEN f.requester_id=$1 THEN 'outgoing' ELSE 'incoming' END as direction
            FROM friendships f
            JOIN users u ON (CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END) = u.id
            WHERE f.requester_id=$1 OR f.addressee_id=$1
            ORDER BY f.created_at DESC
        `, [req.userId]);
        res.json(r.rows.map(f => ({
            id: f.id, username: f.username, displayName: f.display_name,
            avatarColor: f.avatar_color, status: f.status,
            friendStatus: f.friend_status, direction: f.direction
        })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════ DMs ══════════════
app.post('/api/dm/open', auth, async (req, res) => {
    try {
        const { userId } = req.body;
        const [u1, u2] = [req.userId, userId].sort();
        let r = await pool.query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
        if (!r.rows.length) {
            r = await pool.query('INSERT INTO dm_conversations (user1_id, user2_id) VALUES ($1,$2) RETURNING *', [u1, u2]);
        }
        const conv = r.rows[0];
        const other = await pool.query('SELECT id, username, display_name, avatar_color, status FROM users WHERE id=$1', [userId]);
        res.json({ ...conv, otherUser: formatUser(other.rows[0]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dm/conversations', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT d.*,
                u.id as other_id, u.username as other_username, u.display_name as other_display_name,
                u.avatar_color as other_avatar_color, u.status as other_status,
                (SELECT content FROM messages m WHERE m.dm_conversation_id=d.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
                (SELECT created_at FROM messages m WHERE m.dm_conversation_id=d.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at
            FROM dm_conversations d
            JOIN users u ON u.id = CASE WHEN d.user1_id=$1 THEN d.user2_id ELSE d.user1_id END
            WHERE d.user1_id=$1 OR d.user2_id=$1
            ORDER BY last_message_at DESC NULLS LAST
        `, [req.userId]);
        res.json(r.rows.map(d => ({
            id: d.id,
            otherUser: { id: d.other_id, username: d.other_username, displayName: d.other_display_name, avatarColor: d.other_avatar_color, status: d.other_status },
            lastMessage: d.last_message, lastMessageAt: d.last_message_at
        })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dm/:id/messages', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT m.*, u.username, u.display_name, u.avatar_color FROM messages m
            LEFT JOIN users u ON m.user_id=u.id
            WHERE m.dm_conversation_id=$1 ORDER BY m.created_at ASC LIMIT 300
        `, [req.params.id]);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dm/:id/messages', auth, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content?.trim()) return res.status(400).json({ error: 'Empty message' });
        const r = await pool.query(
            'INSERT INTO messages (dm_conversation_id, user_id, content) VALUES ($1,$2,$3) RETURNING *',
            [req.params.id, req.userId, content.trim()]
        );
        const user = await pool.query('SELECT username, display_name, avatar_color FROM users WHERE id=$1', [req.userId]);
        const msg = { ...r.rows[0], ...user.rows[0] };

        // Find the other user in this DM
        const dm = await pool.query('SELECT * FROM dm_conversations WHERE id=$1', [req.params.id]);
        if (dm.rows.length) {
            const otherId = dm.rows[0].user1_id === req.userId ? dm.rows[0].user2_id : dm.rows[0].user1_id;
            notifyUser(otherId, { type: 'dm_message', conversationId: req.params.id, message: msg });
        }
        res.json(msg);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════ SERVERS ══════════════
app.post('/api/servers', auth, async (req, res) => {
    try {
        const { name } = req.body;
        const code = uuidv4().slice(0, 8).toUpperCase();
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        const r = await pool.query(
            'INSERT INTO servers (name, icon_color, owner_id, invite_code) VALUES ($1,$2,$3,$4) RETURNING *',
            [name, color, req.userId, code]
        );
        const srv = r.rows[0];
        await pool.query("INSERT INTO server_members (server_id, user_id, role) VALUES ($1,$2,'owner')", [srv.id, req.userId]);
        // Create default channels
        await pool.query("INSERT INTO channels (server_id, name, position) VALUES ($1,'general',0),($1,'off-topic',1)", [srv.id]);
        res.json(srv);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/servers/join', auth, async (req, res) => {
    try {
        const { inviteCode } = req.body;
        const r = await pool.query('SELECT * FROM servers WHERE invite_code=$1', [inviteCode.toUpperCase().trim()]);
        if (!r.rows.length) return res.status(404).json({ error: 'Invalid invite code' });
        await pool.query('INSERT INTO server_members (server_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.rows[0].id, req.userId]);
        res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/servers', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT s.*, sm.role,
                (SELECT COUNT(*) FROM server_members sm2 WHERE sm2.server_id=s.id) as member_count
            FROM servers s
            JOIN server_members sm ON s.id=sm.server_id AND sm.user_id=$1
            ORDER BY sm.joined_at ASC
        `, [req.userId]);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/servers/:id', auth, async (req, res) => {
    try {
        const srv = await pool.query('SELECT * FROM servers WHERE id=$1', [req.params.id]);
        if (!srv.rows.length) return res.status(404).json({ error: 'Not found' });
        const channels = await pool.query('SELECT * FROM channels WHERE server_id=$1 ORDER BY position ASC', [req.params.id]);
        const members = await pool.query(`
            SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, sm.role
            FROM users u JOIN server_members sm ON u.id=sm.user_id WHERE sm.server_id=$1
            ORDER BY sm.role DESC, u.display_name ASC
        `, [req.params.id]);
        res.json({ ...srv.rows[0], channels: channels.rows, members: members.rows.map(m => ({ ...formatUser(m), role: m.role })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Channels
app.post('/api/servers/:id/channels', auth, async (req, res) => {
    try {
        const { name } = req.body;
        const pos = await pool.query('SELECT COALESCE(MAX(position),0)+1 as p FROM channels WHERE server_id=$1', [req.params.id]);
        const r = await pool.query(
            'INSERT INTO channels (server_id, name, position) VALUES ($1,$2,$3) RETURNING *',
            [req.params.id, name.toLowerCase().replace(/\s+/g, '-'), pos.rows[0].p]
        );
        broadcastServer(req.params.id, { type: 'channel_created', channel: r.rows[0] });
        res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Channel messages
app.get('/api/channels/:id/messages', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT m.*, u.username, u.display_name, u.avatar_color FROM messages m
            LEFT JOIN users u ON m.user_id=u.id
            WHERE m.channel_id=$1 ORDER BY m.created_at ASC LIMIT 300
        `, [req.params.id]);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/channels/:id/messages', auth, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content?.trim()) return res.status(400).json({ error: 'Empty message' });
        const r = await pool.query(
            'INSERT INTO messages (channel_id, user_id, content) VALUES ($1,$2,$3) RETURNING *',
            [req.params.id, req.userId, content.trim()]
        );
        const user = await pool.query('SELECT username, display_name, avatar_color FROM users WHERE id=$1', [req.userId]);
        const msg = { ...r.rows[0], ...user.rows[0] };

        // Get server_id for this channel
        const ch = await pool.query('SELECT server_id FROM channels WHERE id=$1', [req.params.id]);
        if (ch.rows.length) {
            broadcastServer(ch.rows[0].server_id, { type: 'channel_message', channelId: req.params.id, message: msg }, req.userId);
        }
        res.json(msg);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edit / Delete messages
app.patch('/api/messages/:id', auth, async (req, res) => {
    try {
        const { content } = req.body;
        const r = await pool.query('UPDATE messages SET content=$1, edited=true WHERE id=$2 AND user_id=$3 RETURNING *', [content, req.params.id, req.userId]);
        if (!r.rows.length) return res.status(403).json({ error: 'Cannot edit' });
        res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/messages/:id', auth, async (req, res) => {
    try {
        await pool.query('DELETE FROM messages WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════ WEBSOCKET ══════════════
const clients = new Map(); // userId -> Set<ws>

wss.on('connection', (ws) => {
    let userId = null;
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'auth') {
                userId = msg.userId;
                if (!clients.has(userId)) clients.set(userId, new Set());
                clients.get(userId).add(ws);
                // Set online
                pool.query("UPDATE users SET status='online' WHERE id=$1", [userId]);
                broadcastPresence(userId, 'online');
            }
            if (msg.type === 'typing') {
                // Broadcast typing indicator
                if (msg.channelId) {
                    pool.query('SELECT server_id FROM channels WHERE id=$1', [msg.channelId]).then(r => {
                        if (r.rows.length) broadcastServer(r.rows[0].server_id, { type: 'typing', channelId: msg.channelId, userId }, userId);
                    });
                }
            }
        } catch (e) { }
    });
    ws.on('close', () => {
        if (userId && clients.has(userId)) {
            clients.get(userId).delete(ws);
            if (clients.get(userId).size === 0) {
                clients.delete(userId);
                pool.query("UPDATE users SET status='offline' WHERE id=$1", [userId]);
                broadcastPresence(userId, 'offline');
            }
        }
    });
});

function notifyUser(userId, payload) {
    if (clients.has(userId)) {
        const msg = JSON.stringify(payload);
        clients.get(userId).forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
    }
}

function broadcastServer(serverId, payload, excludeUserId = null) {
    pool.query('SELECT user_id FROM server_members WHERE server_id=$1', [serverId]).then(r => {
        r.rows.forEach(row => {
            if (row.user_id !== excludeUserId) notifyUser(row.user_id, payload);
        });
    });
}

function broadcastPresence(userId, status) {
    // Notify all friends of this user
    pool.query(`
        SELECT CASE WHEN requester_id=$1 THEN addressee_id ELSE requester_id END as friend_id
        FROM friendships WHERE (requester_id=$1 OR addressee_id=$1) AND status='accepted'
    `, [userId]).then(r => {
        r.rows.forEach(row => notifyUser(row.friend_id, { type: 'presence', userId, status }));
    });
}

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Concord running on port ${PORT}`));
