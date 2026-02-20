// ═══════════════════════════════════════════
// Concord — Discord Clone Client
// ═══════════════════════════════════════════

let me = null;
let ws = null;
let currentView = 'friends'; // 'friends' | 'dm' | 'channel'
let currentServer = null;
let currentChannel = null;
let currentDM = null;
let servers = [];
let friends = [];
let friendFilter = 'all';
let membersVisible = false;
let typingTimeout = null;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };

// ─── API ───
async function api(path, opts = {}) {
    const token = localStorage.getItem('token');
    const h = { ...opts.headers };
    if (token) h['x-session-token'] = token;
    if (!(opts.body instanceof FormData)) h['Content-Type'] = 'application/json';
    const res = await fetch(path, { ...opts, headers: h, body: opts.body ? (opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body)) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    return data;
}

function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.animation = 'toastOut 0.3s forwards'; setTimeout(() => el.remove(), 300); }, 3500);
}

function initials(name) { return (name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
function timeShort(d) { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function dateFull(d) { return new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
function sameDay(a, b) { const x = new Date(a), y = new Date(b); return x.toDateString() === y.toDateString(); }

// ─── WebSocket ───
function connectWS() {
    if (!me) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', userId: me.id }));
    ws.onmessage = e => {
        try { handleWS(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = () => setTimeout(connectWS, 3000);
}

function handleWS(data) {
    switch (data.type) {
        case 'channel_message':
            if (currentView === 'channel' && currentChannel?.id === data.channelId) {
                appendMsg(data.message);
            }
            break;
        case 'dm_message':
            if (currentView === 'dm' && currentDM?.id === data.conversationId) {
                appendMsg(data.message);
            }
            loadDMList();
            break;
        case 'friend_request':
            toast('New friend request!', 'info');
            loadFriends();
            break;
        case 'friend_accepted':
            toast('Friend request accepted!', 'success');
            loadFriends();
            break;
        case 'presence':
            updatePresence(data.userId, data.status);
            break;
        case 'channel_created':
            if (currentServer?.id === data.channel?.server_id) {
                loadServer(currentServer.id);
            }
            break;
    }
}

function updatePresence(userId, status) {
    document.querySelectorAll(`[data-user-id="${userId}"] .status-dot`).forEach(dot => {
        dot.className = `status-dot ${status}`;
    });
}

// ─── Auth ───
async function checkAuth() {
    if (!localStorage.getItem('token')) return showAuth();
    try {
        me = await api('/api/me');
        showApp();
    } catch {
        localStorage.removeItem('token');
        showAuth();
    }
}

function showAuth() {
    $('#auth-screen').classList.add('active');
    $('#app-screen').classList.remove('active');
}

function showApp() {
    $('#auth-screen').classList.remove('active');
    $('#app-screen').classList.add('active');
    renderUserPanel();
    loadServers();
    loadDMList();
    loadFriends();
    connectWS();
    showFriends();
}

function renderUserPanel() {
    const av = $('#my-avatar');
    av.textContent = initials(me.displayName);
    av.style.background = me.avatarColor;
    $('#my-name').textContent = me.displayName;
    $('#my-tag').textContent = me.username;
    $('#my-status-dot').className = `status-dot ${me.status}`;
}

// Auth tabs
$$('.at-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.at-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        $$('.auth-form').forEach(f => f.classList.remove('visible'));
        $(`#${btn.dataset.form}-form`).classList.add('visible');
    });
});

$('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
        const data = await api('/api/login', { method: 'POST', body: { username: $('#l-user').value, password: $('#l-pass').value } });
        localStorage.setItem('token', data.token);
        me = data.user;
        showApp();
    } catch (err) { $('#l-err').textContent = err.message; }
});

$('#register-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
        const data = await api('/api/register', { method: 'POST', body: { username: $('#r-user').value, displayName: $('#r-name').value, password: $('#r-pass').value } });
        localStorage.setItem('token', data.token);
        me = data.user;
        showApp();
    } catch (err) { $('#r-err').textContent = err.message; }
});

$('#btn-logout').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem('token');
    me = null;
    if (ws) ws.close();
    showAuth();
});

// ─── Servers ───
async function loadServers() {
    try {
        servers = await api('/api/servers');
        renderServerRail();
    } catch {}
}

function renderServerRail() {
    const list = $('#server-list');
    list.innerHTML = servers.map(s => `
        <div class="rail-icon server-icon ${currentServer?.id === s.id ? 'active' : ''}"
             data-id="${s.id}" title="${esc(s.name)}"
             style="background: ${currentServer?.id === s.id ? '' : s.icon_color}">
            ${initials(s.name)}
        </div>
    `).join('');
    list.querySelectorAll('.server-icon').forEach(el => {
        el.addEventListener('click', () => openServer(el.dataset.id));
    });
}

async function openServer(serverId) {
    try {
        const data = await api(`/api/servers/${serverId}`);
        currentServer = data;
        currentView = 'channel';

        // Update rail
        $$('.rail-icon').forEach(i => i.classList.remove('active'));
        document.querySelector(`.server-icon[data-id="${serverId}"]`)?.classList.add('active');

        // Show server sidebar
        $$('.sidebar-panel').forEach(p => p.classList.remove('active'));
        $('#server-sidebar').classList.add('active');
        $('#server-header-name').textContent = data.name;

        // Render channels
        renderChannels(data.channels);

        // Show header actions
        $('#btn-invite-code').style.display = '';
        $('#btn-toggle-members').style.display = '';

        // Open first channel
        if (data.channels.length) {
            openChannel(data.channels[0]);
        }

        // Render members
        renderMembersPanel(data.members);
    } catch (err) { toast('Failed to load server', 'error'); }
}

async function loadServer(serverId) {
    try {
        const data = await api(`/api/servers/${serverId}`);
        currentServer = data;
        renderChannels(data.channels);
        renderMembersPanel(data.members);
    } catch {}
}

function renderChannels(channels) {
    const list = $('#channel-list');
    list.innerHTML = channels.map(c => `
        <div class="channel-item ${currentChannel?.id === c.id ? 'active' : ''}" data-id="${c.id}" data-name="${esc(c.name)}">
            <span class="channel-hash">#</span>
            ${esc(c.name)}
        </div>
    `).join('');
    list.querySelectorAll('.channel-item').forEach(el => {
        el.addEventListener('click', () => {
            const ch = currentServer.channels.find(c => c.id === el.dataset.id);
            if (ch) openChannel(ch);
        });
    });
}

function openChannel(channel) {
    currentChannel = channel;
    currentDM = null;
    currentView = 'channel';

    $$('.channel-item').forEach(i => i.classList.toggle('active', i.dataset.id === channel.id));
    $$('.main-view').forEach(v => v.classList.remove('active'));
    $('#chat-view').classList.add('active');

    $('#header-icon').textContent = '#';
    $('#header-title').textContent = channel.name;
    $('#header-topic').textContent = channel.topic || '';
    $('#msg-input').placeholder = `Message #${channel.name}`;

    loadMessages(`/api/channels/${channel.id}/messages`);
}

function renderMembersPanel(members) {
    const online = members.filter(m => m.status !== 'offline');
    const offline = members.filter(m => m.status === 'offline');
    let html = '';
    if (online.length) {
        html += `<h3>Online — ${online.length}</h3>`;
        html += online.map(m => memberEntry(m)).join('');
    }
    if (offline.length) {
        html += `<h3 style="margin-top:16px">Offline — ${offline.length}</h3>`;
        html += offline.map(m => memberEntry(m, true)).join('');
    }
    $('#members-list-panel').innerHTML = html;
}

function memberEntry(m, offline = false) {
    return `
        <div class="member-entry ${offline ? 'offline' : ''}" data-user-id="${m.id}">
            <div class="avatar-with-status">
                <div class="avatar" style="background:${m.avatarColor}">${initials(m.displayName)}</div>
                <div class="status-dot ${m.status}"></div>
            </div>
            <span class="m-name">${esc(m.displayName)}</span>
            ${m.role === 'owner' ? '<span class="m-role">Owner</span>' : ''}
        </div>
    `;
}

// ─── DMs ───
async function loadDMList() {
    try {
        const convos = await api('/api/dm/conversations');
        const list = $('#dm-list');
        if (!convos.length) {
            list.innerHTML = '<div style="padding:12px;color:var(--text-faint);font-size:13px;text-align:center">No conversations yet</div>';
            return;
        }
        list.innerHTML = convos.map(c => `
            <div class="dm-item ${currentDM?.id === c.id ? 'active' : ''}" data-id="${c.id}" data-user-id="${c.otherUser.id}">
                <div class="avatar-with-status">
                    <div class="avatar" style="background:${c.otherUser.avatarColor}">${initials(c.otherUser.displayName)}</div>
                    <div class="status-dot ${c.otherUser.status}"></div>
                </div>
                <div class="dm-info">
                    <div class="dm-name">${esc(c.otherUser.displayName)}</div>
                    ${c.lastMessage ? `<div class="dm-preview">${esc(c.lastMessage.slice(0, 40))}</div>` : ''}
                </div>
            </div>
        `).join('');
        list.querySelectorAll('.dm-item').forEach(el => {
            el.addEventListener('click', () => openDM(el.dataset.id, el.dataset.userId));
        });
    } catch {}
}

async function openDM(convId, userId) {
    try {
        let conv;
        if (convId && convId !== 'undefined') {
            currentDM = { id: convId };
        } else {
            conv = await api('/api/dm/open', { method: 'POST', body: { userId } });
            currentDM = { id: conv.id };
            convId = conv.id;
        }
        currentView = 'dm';
        currentChannel = null;

        // Get other user info
        const user = conv?.otherUser || (await getDMUser(convId, userId));

        // Switch to DM sidebar
        goHome();
        $$('.dm-item').forEach(i => i.classList.toggle('active', i.dataset.id === convId));

        $$('.main-view').forEach(v => v.classList.remove('active'));
        $('#chat-view').classList.add('active');

        $('#header-icon').textContent = '@';
        $('#header-title').textContent = user?.displayName || 'Direct Message';
        $('#header-topic').textContent = '';
        $('#msg-input').placeholder = `Message @${user?.displayName || 'user'}`;
        $('#btn-invite-code').style.display = 'none';
        $('#btn-toggle-members').style.display = 'none';
        $('#members-panel').classList.add('hidden');

        loadMessages(`/api/dm/${convId}/messages`);
        loadDMList();
    } catch (err) { toast('Failed to open DM', 'error'); }
}

async function getDMUser(convId, userId) {
    try {
        const convos = await api('/api/dm/conversations');
        const c = convos.find(x => x.id === convId);
        return c?.otherUser;
    } catch { return null; }
}

function goHome() {
    currentServer = null;
    $$('.rail-icon').forEach(i => i.classList.remove('active'));
    $('#home-btn').classList.add('active');
    $$('.sidebar-panel').forEach(p => p.classList.remove('active'));
    $('#dm-sidebar').classList.add('active');
}

// ─── Friends ───
async function loadFriends() {
    try {
        friends = await api('/api/friends');
        renderFriends();
    } catch {}
}

function showFriends() {
    currentView = 'friends';
    currentChannel = null;
    currentDM = null;
    goHome();

    $$('.main-view').forEach(v => v.classList.remove('active'));
    $('#friends-view').classList.add('active');
    $('#header-icon').innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`;
    $('#header-title').textContent = 'Friends';
    $('#header-topic').textContent = '';
    $('#btn-invite-code').style.display = 'none';
    $('#btn-toggle-members').style.display = 'none';
    $('#members-panel').classList.add('hidden');
    renderFriends();
}

$$('.ft-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.ft-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        friendFilter = btn.dataset.filter;
        renderFriends();
    });
});

function renderFriends() {
    const list = $('#friends-list');
    const addForm = $('#add-friend-form');

    if (friendFilter === 'add') {
        list.classList.add('hidden');
        addForm.classList.remove('hidden');
        return;
    }
    list.classList.remove('hidden');
    addForm.classList.add('hidden');

    let filtered = friends;
    if (friendFilter === 'online') filtered = friends.filter(f => f.friendStatus === 'accepted' && f.status !== 'offline');
    else if (friendFilter === 'pending') filtered = friends.filter(f => f.friendStatus === 'pending');
    else filtered = friends.filter(f => f.friendStatus === 'accepted');

    if (!filtered.length) {
        list.innerHTML = `<div class="empty-state"><p>${friendFilter === 'pending' ? 'No pending requests' : 'No friends to show here'}</p></div>`;
        return;
    }

    list.innerHTML = filtered.map(f => {
        let actions = '';
        if (f.friendStatus === 'pending' && f.direction === 'incoming') {
            actions = `
                <button class="fa-btn accept" onclick="acceptFriend('${f.id}')" title="Accept">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <button class="fa-btn danger" onclick="declineFriend('${f.id}')" title="Decline">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>`;
        } else if (f.friendStatus === 'pending' && f.direction === 'outgoing') {
            actions = `<button class="fa-btn danger" onclick="declineFriend('${f.id}')" title="Cancel">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>`;
        } else {
            actions = `
                <button class="fa-btn" onclick="startDMWith('${f.id}')" title="Message">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </button>
                <button class="fa-btn danger" onclick="removeFriend('${f.id}')" title="Remove">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>`;
        }

        const statusText = f.friendStatus === 'pending'
            ? (f.direction === 'incoming' ? 'Incoming request' : 'Outgoing request')
            : (f.status || 'offline');

        return `
            <div class="friend-entry" data-user-id="${f.id}">
                <div class="friend-left">
                    <div class="avatar-with-status">
                        <div class="avatar avatar-lg" style="background:${f.avatarColor}">${initials(f.displayName)}</div>
                        <div class="status-dot ${f.status}"></div>
                    </div>
                    <div>
                        <div class="friend-name">${esc(f.displayName)}</div>
                        <div class="friend-status-text">${statusText}</div>
                    </div>
                </div>
                <div class="friend-actions">${actions}</div>
            </div>
        `;
    }).join('');
}

// Friend actions (global for onclick)
window.acceptFriend = async (userId) => {
    try { await api('/api/friends/accept', { method: 'POST', body: { userId } }); toast('Friend request accepted!', 'success'); loadFriends(); } catch (e) { toast(e.message, 'error'); }
};
window.declineFriend = async (userId) => {
    try { await api('/api/friends/decline', { method: 'POST', body: { userId } }); loadFriends(); } catch (e) { toast(e.message, 'error'); }
};
window.removeFriend = async (userId) => {
    try { await api('/api/friends/remove', { method: 'POST', body: { userId } }); loadFriends(); } catch (e) { toast(e.message, 'error'); }
};
window.startDMWith = async (userId) => {
    try {
        const conv = await api('/api/dm/open', { method: 'POST', body: { userId } });
        openDM(conv.id, userId);
    } catch (e) { toast(e.message, 'error'); }
};

$('#btn-send-request').addEventListener('click', async () => {
    const input = $('#add-friend-username');
    try {
        await api('/api/friends/request', { method: 'POST', body: { username: input.value } });
        toast('Friend request sent!', 'success');
        input.value = '';
        $('#friend-err').textContent = '';
        loadFriends();
    } catch (e) { $('#friend-err').textContent = e.message; }
});

$('#add-friend-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('#btn-send-request').click(); }
});

// ─── Messages ───
let lastMsgUserId = null;
let lastMsgDate = null;

async function loadMessages(url) {
    try {
        const msgs = await api(url);
        const container = $('#messages');
        container.innerHTML = '';
        lastMsgUserId = null;
        lastMsgDate = null;
        msgs.forEach(m => appendMsg(m, false));
        scrollBottom();
    } catch (err) { toast('Failed to load messages', 'error'); }
}

function appendMsg(msg, scroll = true) {
    const container = $('#messages');
    const msgDate = new Date(msg.created_at);

    // Date divider
    if (!lastMsgDate || !sameDay(lastMsgDate, msg.created_at)) {
        container.innerHTML += `<div class="msg-divider"><span>${dateFull(msg.created_at)}</span></div>`;
    }

    const compact = lastMsgUserId === msg.user_id && lastMsgDate && sameDay(lastMsgDate, msg.created_at)
        && (msgDate - new Date(lastMsgDate)) < 5 * 60 * 1000;

    if (compact) {
        container.innerHTML += `
            <div class="msg msg-compact">
                <span class="msg-time-inline">${timeShort(msg.created_at)}</span>
                <div class="msg-body">
                    <div class="msg-text">${esc(msg.content)}</div>
                </div>
            </div>`;
    } else {
        container.innerHTML += `
            <div class="msg" style="margin-top:16px">
                <div class="avatar" style="background:${msg.avatar_color || '#5865F2'}">${initials(msg.display_name)}</div>
                <div class="msg-body">
                    <div class="msg-head">
                        <span class="msg-author" style="color:${msg.avatar_color || '#fff'}">${esc(msg.display_name)}</span>
                        <span class="msg-time">${timeShort(msg.created_at)}</span>
                        ${msg.edited ? '<span class="msg-edited">(edited)</span>' : ''}
                    </div>
                    <div class="msg-text">${esc(msg.content)}</div>
                </div>
            </div>`;
    }

    lastMsgUserId = msg.user_id;
    lastMsgDate = msg.created_at;
    if (scroll) scrollBottom();
}

function scrollBottom() {
    const wrap = $('.messages-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

// Send message
$('#msg-input').addEventListener('keydown', async e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const input = $('#msg-input');
        const content = input.value.trim();
        if (!content) return;
        input.value = '';

        try {
            let url;
            if (currentView === 'channel' && currentChannel) {
                url = `/api/channels/${currentChannel.id}/messages`;
            } else if (currentView === 'dm' && currentDM) {
                url = `/api/dm/${currentDM.id}/messages`;
            } else return;

            const msg = await api(url, { method: 'POST', body: { content } });
            appendMsg(msg);
            if (currentView === 'dm') loadDMList();
        } catch (err) { toast('Failed to send message', 'error'); }
    }
});

// ─── Navigation ───
$('#home-btn').addEventListener('click', showFriends);
$('#nav-friends').addEventListener('click', showFriends);

// ─── Modals ───
window.closeModal = () => { $('#modal-bg').classList.add('hidden'); };

function openModal(title, bodyHtml) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal-bg').classList.remove('hidden');
}

// Add server
$('#btn-add-server').addEventListener('click', () => {
    openModal('Add a Server', `
        <div style="display:flex;flex-direction:column;gap:12px">
            <button class="btn-primary" id="m-create-server">Create My Own</button>
            <div style="text-align:center;color:var(--text-muted);font-size:13px">or</div>
            <div class="field">
                <label>INVITE CODE</label>
                <input type="text" id="m-join-code" placeholder="Enter invite code" style="text-transform:uppercase;letter-spacing:2px;text-align:center">
            </div>
            <button class="btn-primary" id="m-join-server" style="background:var(--green)">Join Server</button>
        </div>
    `);
    document.getElementById('m-create-server').addEventListener('click', () => {
        openModal('Create a Server', `
            <div class="field">
                <label>SERVER NAME</label>
                <input type="text" id="m-server-name" placeholder="My Awesome Server" required>
            </div>
            <div class="btn-row">
                <button class="btn-cancel" onclick="closeModal()">Cancel</button>
                <button class="btn-primary btn-sm" id="m-do-create">Create</button>
            </div>
        `);
        document.getElementById('m-do-create').addEventListener('click', async () => {
            const name = document.getElementById('m-server-name').value.trim();
            if (!name) return;
            try {
                const srv = await api('/api/servers', { method: 'POST', body: { name } });
                closeModal();
                toast(`Server "${srv.name}" created!`, 'success');
                await loadServers();
                openServer(srv.id);
            } catch (e) { toast(e.message, 'error'); }
        });
    });
    document.getElementById('m-join-server').addEventListener('click', async () => {
        const code = document.getElementById('m-join-code').value.trim();
        if (!code) return;
        try {
            const srv = await api('/api/servers/join', { method: 'POST', body: { inviteCode: code } });
            closeModal();
            toast(`Joined "${srv.name}"!`, 'success');
            await loadServers();
            openServer(srv.id);
        } catch (e) { toast(e.message, 'error'); }
    });
});

// Invite code
$('#btn-invite-code').addEventListener('click', () => {
    if (!currentServer) return;
    openModal('Invite Friends', `
        <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">Share this invite code with friends:</p>
        <div class="invite-display">
            <code>${currentServer.invite_code}</code>
            <button onclick="navigator.clipboard.writeText('${currentServer.invite_code}');this.textContent='Copied!'">Copy Code</button>
        </div>
    `);
});

// Add channel
$('#btn-add-channel').addEventListener('click', () => {
    if (!currentServer) return;
    openModal('Create Channel', `
        <div class="field">
            <label>CHANNEL NAME</label>
            <input type="text" id="m-ch-name" placeholder="new-channel">
        </div>
        <div class="btn-row">
            <button class="btn-cancel" onclick="closeModal()">Cancel</button>
            <button class="btn-primary btn-sm" id="m-do-channel">Create</button>
        </div>
    `);
    document.getElementById('m-do-channel').addEventListener('click', async () => {
        const name = document.getElementById('m-ch-name').value.trim();
        if (!name) return;
        try {
            await api(`/api/servers/${currentServer.id}/channels`, { method: 'POST', body: { name } });
            closeModal();
            loadServer(currentServer.id);
        } catch (e) { toast(e.message, 'error'); }
    });
});

// Toggle members
$('#btn-toggle-members').addEventListener('click', () => {
    membersVisible = !membersVisible;
    $('#members-panel').classList.toggle('hidden', !membersVisible);
});

// New DM button
$('#btn-new-dm').addEventListener('click', () => {
    openModal('New Direct Message', `
        <div class="field">
            <label>USERNAME</label>
            <input type="text" id="m-dm-user" placeholder="Enter a username">
        </div>
        <div class="btn-row">
            <button class="btn-cancel" onclick="closeModal()">Cancel</button>
            <button class="btn-primary btn-sm" id="m-do-dm">Open DM</button>
        </div>
    `);
    document.getElementById('m-do-dm').addEventListener('click', async () => {
        const username = document.getElementById('m-dm-user').value.trim();
        if (!username) return;
        try {
            // First find user
            const friends = await api('/api/friends');
            const friend = friends.find(f => f.username === username.toLowerCase());
            if (!friend) { toast('User not found (must be a friend)', 'error'); return; }
            closeModal();
            startDMWith(friend.id);
        } catch (e) { toast(e.message, 'error'); }
    });
});

// Settings (simple status changer)
$('#btn-settings').addEventListener('click', () => {
    openModal('Settings', `
        <div class="field">
            <label>STATUS</label>
            <select id="m-status" style="width:100%;padding:10px;background:var(--bg-dark);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-family:var(--font);">
                <option value="online" ${me.status === 'online' ? 'selected' : ''}>🟢 Online</option>
                <option value="idle" ${me.status === 'idle' ? 'selected' : ''}>🌙 Idle</option>
                <option value="dnd" ${me.status === 'dnd' ? 'selected' : ''}>⛔ Do Not Disturb</option>
                <option value="offline" ${me.status === 'offline' ? 'selected' : ''}>⚫ Invisible</option>
            </select>
        </div>
        <div class="btn-row">
            <button class="btn-cancel" onclick="closeModal()">Cancel</button>
            <button class="btn-primary btn-sm" id="m-save-status">Save</button>
        </div>
    `);
    document.getElementById('m-save-status').addEventListener('click', async () => {
        const status = document.getElementById('m-status').value;
        try {
            await api('/api/me/status', { method: 'PATCH', body: { status } });
            me.status = status;
            renderUserPanel();
            closeModal();
            toast('Status updated', 'success');
        } catch (e) { toast(e.message, 'error'); }
    });
});

// Escape key closes modal
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ─── Init ───
checkAuth();
