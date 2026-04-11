// ══════════════════════════════════════════════════════════
// Claude Code — Frontend Logic (Full Overhaul)
// ══════════════════════════════════════════════════════════

const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const msgContainer = document.getElementById('msgContainer');
const messagesEl = document.getElementById('messages');
const chatList = document.getElementById('chatList');
const scrollFab = document.getElementById('scrollFab');

// ── State ──
let conversations = [];
let currentChatId = null;
let currentMessages = [];
let isGenerating = false;
let customSystemPrompt = '';
let generationId = 0;
let pendingAbortResolve = null;
let pywebviewReady = false;
let selectedModel = 'claude-sonnet-4-20250514';

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
function init() {
    conversations = JSON.parse(localStorage.getItem('cc_conversations') || '[]');
    if (conversations.length === 0) { newChat(); } else { switchChat(conversations[0].id); }
    waitForPywebview().then(() => { pywebviewReady = true; reloadFromFiles(); });
    initParticles();
    initScrollFab();
    initDragDrop();
    initKeyboardShortcuts();
    initSidebarResize();
}

function waitForPywebview() {
    return new Promise(resolve => {
        if (window.pywebview && window.pywebview.api) { resolve(); return; }
        window.addEventListener('pywebviewready', () => resolve());
        let c = 0;
        const iv = setInterval(() => { c++; if (window.pywebview && window.pywebview.api) { clearInterval(iv); resolve(); } if (c > 50) clearInterval(iv); }, 100);
    });
}

function reloadFromFiles() {
    if (!window.pywebview?.api) return;
    window.pywebview.api.load_conversations().then(json => {
        const fc = JSON.parse(json || '[]');
        if (fc.length > 0) {
            conversations = fc;
            renderChatList();
            if (currentChatId) {
                window.pywebview.api.load_chat_messages(currentChatId).then(mj => {
                    currentMessages = JSON.parse(mj || '[]');
                    renderMessages();
                });
            }
        }
    });
}

// ══════════════════════════════════════════════════════════
// PARTICLES
// ══════════════════════════════════════════════════════════
function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, particles = [];

    function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < 40; i++) {
        particles.push({
            x: Math.random() * w, y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
            r: Math.random() * 1.5 + 0.5, o: Math.random() * 0.3 + 0.05
        });
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        particles.forEach(p => {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(185,231,255,${p.o})`;
            ctx.fill();
        });
        // Draw connections
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < 150) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(185,231,255,${0.03 * (1 - d / 150)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
        requestAnimationFrame(draw);
    }
    draw();
}

// ══════════════════════════════════════════════════════════
// SCROLL-TO-BOTTOM FAB
// ══════════════════════════════════════════════════════════
function initScrollFab() {
    messagesEl.addEventListener('scroll', () => {
        const distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
        scrollFab.classList.toggle('hidden', distFromBottom < 100);
    });
}

// ══════════════════════════════════════════════════════════
// DRAG & DROP
// ══════════════════════════════════════════════════════════
function initDragDrop() {
    const overlay = document.getElementById('dropOverlay');
    const wrapper = document.getElementById('inputWrapper');
    let dragCount = 0;

    document.addEventListener('dragenter', e => { e.preventDefault(); dragCount++; overlay.classList.add('active'); wrapper.classList.add('drag-over'); });
    document.addEventListener('dragleave', e => { e.preventDefault(); dragCount--; if (dragCount <= 0) { dragCount = 0; overlay.classList.remove('active'); wrapper.classList.remove('drag-over'); } });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
        e.preventDefault(); dragCount = 0; overlay.classList.remove('active'); wrapper.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            const paths = files.map(f => f.path || f.name).join(', ');
            input.value += (input.value ? '\n' : '') + `Please read and analyze these files: ${paths}`;
            autoResize(input); toggleSend(); input.focus();
            showToast(`${files.length} file(s) attached`, 'info');
        }
    });
}

// ══════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════
function initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
        // Ctrl+N — new chat
        if (e.ctrlKey && e.key === 'n') { e.preventDefault(); newChat(); }
        // Ctrl+O — attach file
        if (e.ctrlKey && e.key === 'o') { e.preventDefault(); attachFile(); }
        // Ctrl+R — quick command
        if (e.ctrlKey && e.key === 'r') { e.preventDefault(); quickCommand(); }
        // Escape — close modal / close dropdown
        if (e.key === 'Escape') {
            closeSettings();
            document.getElementById('modelDropdown')?.classList.remove('open');
            document.getElementById('sidebar')?.classList.remove('open');
        }
        // Focus input with /
        if (e.key === '/' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault(); input.focus();
        }
    });
}

// ══════════════════════════════════════════════════════════
// SIDEBAR RESIZE
// ══════════════════════════════════════════════════════════
function initSidebarResize() {
    const handle = document.getElementById('sidebarResize');
    const sidebar = document.getElementById('sidebar');
    if (!handle || !sidebar) return;
    let startX, startW;

    handle.addEventListener('mousedown', e => {
        e.preventDefault(); startX = e.clientX; startW = sidebar.offsetWidth;
        handle.classList.add('active');
        const onMove = e2 => {
            const w = Math.max(200, Math.min(500, startW + e2.clientX - startX));
            sidebar.style.width = w + 'px'; sidebar.style.minWidth = w + 'px';
        };
        const onUp = () => { handle.classList.remove('active'); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ══════════════════════════════════════════════════════════
// TOASTS
// ══════════════════════════════════════════════════════════
function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'toastOut .3s forwards'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ══════════════════════════════════════════════════════════
// MODEL SELECTOR
// ══════════════════════════════════════════════════════════
function toggleModelDropdown() {
    document.getElementById('modelDropdown').classList.toggle('open');
}

function selectModel(el) {
    selectedModel = el.dataset.value;
    document.getElementById('modelLabel').textContent = el.querySelector('.model-option-name').textContent.replace('Claude ', '');
    document.querySelectorAll('.model-option').forEach(o => { o.classList.remove('selected'); o.removeAttribute('aria-selected'); });
    el.classList.add('selected'); el.setAttribute('aria-selected', 'true');
    document.getElementById('modelDropdown').classList.remove('open');
    showToast(`Switched to ${el.querySelector('.model-option-name').textContent}`, 'info');
}

// Close dropdown on outside click
document.addEventListener('click', e => {
    const dd = document.getElementById('modelDropdown');
    const btn = document.getElementById('modelBtn');
    if (dd && !dd.contains(e.target) && !btn.contains(e.target)) dd.classList.remove('open');
});

// ══════════════════════════════════════════════════════════
// SIDEBAR TOGGLE
// ══════════════════════════════════════════════════════════
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

// ══════════════════════════════════════════════════════════
// CHAT SEARCH
// ══════════════════════════════════════════════════════════
function filterChats(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(item => {
        const label = item.querySelector('.label')?.textContent.toLowerCase() || '';
        item.style.display = label.includes(q) ? '' : 'none';
    });
}

// ══════════════════════════════════════════════════════════
// TEXTAREA & INPUT
// ══════════════════════════════════════════════════════════
function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    // Update char count
    const cc = document.getElementById('charCount');
    if (cc) cc.textContent = el.value.length > 0 ? el.value.length : '';
}

function toggleSend() {
    if (isGenerating) return;
    sendBtn.classList.toggle('disabled', !input.value.trim());
}

function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function scrollBottom() {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
}

function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════════════════
// MARKDOWN RENDERING
// ══════════════════════════════════════════════════════════
function renderMarkdown(text) {
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const l = lang || 'code';
        const ph = `%%CB_${codeBlocks.length}%%`;
        codeBlocks.push(`<div class="code-block"><div class="code-header"><span>${esc(l)}</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div><div class="code-body">${esc(code.trimEnd())}</div></div>`);
        return ph;
    });
    const inlineCodes = [];
    text = text.replace(/`([^`]+)`/g, (_, code) => { const ph = `%%IC_${inlineCodes.length}%%`; inlineCodes.push(`<span class="inline-code">${esc(code)}</span>`); return ph; });

    // Tables
    text = text.replace(/((?:\|.+\|(?:\n|$))+)/g, tb => {
        const rows = tb.trim().split('\n');
        if (rows.length < 2) return tb;
        const isSep = /^\|[\s\-:|]+\|$/.test(rows[1]);
        let h = '<table class="md-table"><thead><tr>';
        rows[0].split('|').filter((_, i, a) => i > 0 && i < a.length - 1).forEach(c => h += `<th>${c.trim()}</th>`);
        h += '</tr></thead><tbody>';
        for (let i = isSep ? 2 : 1; i < rows.length; i++) {
            const cells = rows[i].split('|').filter((_, j, a) => j > 0 && j < a.length - 1);
            if (!cells.length) continue;
            h += '<tr>'; cells.forEach(c => h += `<td>${c.trim()}</td>`); h += '</tr>';
        }
        return h + '</tbody></table>';
    });

    text = text.replace(/^(---|\*\*\*|___)\s*$/gm, '<hr class="md-hr">');
    text = text.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    text = text.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');
    text = text.replace(/^(?:> .+(?:\n|$))+/gm, b => `<blockquote class="md-quote">${b.replace(/^> /gm, '').trim()}</blockquote>`);
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" target="_blank">$1</a>');

    let html = text.split(/\n\n+/).map(p => {
        p = p.trim(); if (!p) return '';
        if (/^<(div|h[1-4]|blockquote|table|hr|ul|ol)/.test(p) || p.startsWith('%%CB_')) return p;
        if (/^[-*] /.test(p)) return '<ul class="md-ul">' + p.split(/\n/).map(l => '<li>' + l.replace(/^[-*] /, '') + '</li>').join('') + '</ul>';
        if (/^\d+\. /.test(p)) return '<ol class="md-ol">' + p.split(/\n/).map(l => '<li>' + l.replace(/^\d+\. /, '') + '</li>').join('') + '</ol>';
        return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('');

    codeBlocks.forEach((b, i) => html = html.replace(`%%CB_${i}%%`, b));
    inlineCodes.forEach((c, i) => html = html.replace(`%%IC_${i}%%`, c));
    return html;
}

// ══════════════════════════════════════════════════════════
// COPY CODE
// ══════════════════════════════════════════════════════════
function copyCode(btn) {
    const body = btn.closest('.code-block').querySelector('.code-body');
    navigator.clipboard.writeText(body.textContent).then(() => {
        btn.textContent = 'Copied!'; btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    });
}

// ══════════════════════════════════════════════════════════
// TOOL CALLS
// ══════════════════════════════════════════════════════════
function toggleToolCall(header) {
    header.classList.toggle('expanded');
    const d = header.closest('.tool-call').querySelector('.tool-call-details');
    if (d) d.classList.toggle('visible');
}

function renderToolCall(name, toolInput, result) {
    const inp = typeof toolInput === 'string' ? (() => { try { return JSON.parse(toolInput || '{}'); } catch { return {}; } })() : (toolInput || {});
    const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput, null, 2);
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

    const labels = {
        'read_file':'Read','write_file':'Write','run_command':'Run','cd':'cd',
        'create_folder':'Create folder','create_directory':'Create directory','list_files':'List files',
        'search_files':'Search','replace_in_file':'Replace','move_file':'Move','copy_file':'Copy',
        'delete_file':'Delete','get_file_info':'File info','find_files':'Find files','open_url':'Open URL',
        'open_file':'Open file','get_system_info':'System info','clipboard_read':'Read clipboard',
        'clipboard_write':'Write clipboard','process_list':'Process list','kill_process':'Kill process',
        'screenshot':'Screenshot','record_screen':'Record',
        'discord_login':'Discord login','discord_status':'Discord status',
        'discord_friends':'Discord servers','discord_dms':'Discord DMs','discord_send':'Discord send','discord_channels':'Discord channels'
    };
    const label = labels[name] || name;

    let summary = '';
    try {
        if (name === 'read_file' && inp.path) { const l = inp.start_line ? ` · lines ${inp.start_line}-${inp.end_line||'?'}` : ''; summary = `${label} <code>${esc(inp.path)}</code>${l}`; }
        else if (name === 'write_file' && inp.path) { summary = `${label} <code>${esc(inp.path)}</code> · ${(inp.content||'').length} chars`; }
        else if (name === 'run_command' && inp.command) { const c = inp.command.length > 80 ? inp.command.slice(0,77)+'...' : inp.command; summary = `<code>${esc(c)}</code>`; }
        else if (name === 'cd' && inp.path) { summary = `<code>${esc(inp.path)}</code>`; }
        else if ((name==='create_folder'||name==='create_directory') && inp.path) { summary = `<code>${esc(inp.path)}</code>`; }
        else if (name === 'list_files') { summary = `<code>${esc(inp.path||'.')}</code>`; }
        else if (name === 'search_files' && inp.pattern) { summary = `"${esc(inp.pattern)}" in <code>${esc(inp.path||'.')}</code>`; }
        else if (name === 'replace_in_file' && inp.path) { summary = `<code>${esc(inp.path)}</code>`; }
        else if ((name==='move_file'||name==='copy_file') && inp.source) { summary = `<code>${esc(inp.source)}</code> → <code>${esc(inp.destination||'?')}</code>`; }
        else if (name === 'delete_file' && inp.path) { summary = `<code>${esc(inp.path)}</code>`; }
        else if (name === 'find_files' && inp.pattern) { summary = `<code>${esc(inp.pattern)}</code>`; }
        else if (name === 'open_url' && inp.url) { summary = `<code>${esc(inp.url)}</code>`; }
        else if (name === 'open_file' && inp.path) { summary = `<code>${esc(inp.path)}</code>`; }
        else if (name === 'kill_process') { summary = inp.pid ? `PID ${inp.pid}` : inp.name ? `<code>${esc(inp.name)}</code>` : ''; }
        else if (name === 'clipboard_write' && inp.text) { summary = `"${esc(inp.text.length>60?inp.text.slice(0,57)+'...':inp.text)}"`; }
        else if (name === 'get_file_info' && inp.path) { summary = `<code>${esc(inp.path)}</code>`; }
        else if (name === 'process_list' && inp.filter) { summary = `filter: "${esc(inp.filter)}"`; }
        else if (name === 'screenshot') { summary = `mode: ${esc(inp.mode||'full')}`; }
        else if (name === 'record_screen') { summary = `${esc(inp.action||'')}${inp.duration ? ' · '+inp.duration+'s' : ''}${inp.format ? ' · '+inp.format : ''}`; }
        else if (name === 'discord_login') { summary = 'Authenticating...'; }
        else if (name === 'discord_send' && inp.user_id) { summary = `to user <code>${esc(inp.user_id)}</code>${inp.file_path ? ' with file' : ''}`; }
        else if (name === 'discord_channels' && (inp.server_name||inp.server_id)) { summary = `<code>${esc(inp.server_name||inp.server_id)}</code>`; }
    } catch(e) {}

    let resultSummary = '';
    if (typeof result === 'string' && result !== '(cached)') {
        const fl = result.split('\n')[0];
        resultSummary = fl.length > 80 ? fl.slice(0,77)+'...' : fl;
    }

    return `<div class="tool-call">
        <div class="tool-call-header" onclick="toggleToolCall(this)">
            <span class="tool-chevron">›</span>
            <span class="tool-name">${label}</span>
        </div>
        ${summary ? `<div class="tool-call-summary">${summary}</div>` : ''}
        ${resultSummary ? `<div class="tool-call-summary">${esc(resultSummary)}</div>` : ''}
        <div class="tool-call-details">
            <div class="tool-call-details-section"><div class="tool-call-details-label">Input</div><div class="tool-call-details-content">${esc(inputStr)}</div></div>
            <div class="tool-call-details-section"><div class="tool-call-details-label">Output</div><div class="tool-call-details-content">${esc(resultStr)}</div></div>
        </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════
// SEND MESSAGE
// ══════════════════════════════════════════════════════════
async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    if (isGenerating) { await stopGeneration(); }

    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.remove();

    const userDiv = document.createElement('div');
    userDiv.className = 'message user';
    userDiv.innerHTML = `<div class="msg-bubble">${esc(text)}</div>`;
    msgContainer.appendChild(userDiv);
    currentMessages.push({ role: 'user', content: text });

    input.value = ''; autoResize(input); toggleSend(); scrollBottom();

    // Update title
    const chat = conversations.find(c => c.id === currentChatId);
    if (chat && chat.title === 'New Chat') {
        chat.title = text.substring(0, 50);
        saveConversations(); renderChatList();
        const tt = document.getElementById('topbarTitle');
        if (tt) tt.textContent = chat.title;
    }

    generationId++;
    const thisGenId = generationId;
    setGenerating(true);

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const assistantDiv = document.createElement('div');
    assistantDiv.className = 'message assistant';
    assistantDiv.innerHTML = `
        <div class="msg-avatar"><svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="32" height="32" rx="10" fill="url(#maG)"/><circle cx="13" cy="16" r="2.5" fill="#080d11"/><circle cx="23" cy="16" r="2.5" fill="#080d11"/><circle cx="14" cy="14.8" r="1" fill="rgba(255,255,255,0.6)"/><circle cx="24" cy="14.8" r="1" fill="rgba(255,255,255,0.6)"/><path d="M13 23Q18 27 23 23" stroke="#080d11" stroke-width="2" stroke-linecap="round" fill="none"/><defs><linearGradient id="maG" x1="0" y1="0" x2="36" y2="36"><stop stop-color="#B9E7FF"/><stop offset="1" stop-color="#7BC8F6"/></linearGradient></defs></svg></div>
        <div class="msg-body">
            <div class="msg-name">Claude <span class="msg-timestamp">${now}</span></div>
            <div class="msg-text">
                <div class="thinking"><div class="thinking-dots"><span></span><span></span><span></span></div>Thinking…</div>
            </div>
        </div>`;
    msgContainer.appendChild(assistantDiv);
    scrollBottom();

    const msgText = assistantDiv.querySelector('.msg-text');

    try {
        const historyJson = JSON.stringify(currentMessages);
        const resultJson = await window.pywebview.api.send_message(historyJson, selectedModel, customSystemPrompt);

        if (thisGenId !== generationId) { if (pendingAbortResolve) { pendingAbortResolve(); pendingAbortResolve = null; } return; }

        const result = JSON.parse(resultJson);

        if (result.error) {
            msgText.innerHTML = `<p style="color:var(--danger)">Error: ${esc(result.error)}</p>`;
            showToast('Generation failed', 'error');
            setGenerating(false); return;
        }

        const hasContent = msgText.querySelector('.tool-call, p, .code-block, ul, ol');
        if (!hasContent) {
            let html = '';
            for (const step of result.steps) {
                if (step.type === 'tool_use') html += renderToolCall(step.name, step.input, step.result);
                else if (step.type === 'text') html += renderMarkdown(step.content);
            }
            if (!html && result.final_text) html = renderMarkdown(result.final_text);
            if (html) msgText.innerHTML = html;
        }

        const lt = msgText.querySelector('.thinking'); if (lt) lt.remove();
        currentMessages = result.messages;
        saveChatMessages();

    } catch (err) {
        if (thisGenId !== generationId) return;
        msgText.innerHTML = `<p style="color:var(--danger)">Error: ${esc(err.toString())}</p>`;
    }

    if (pendingAbortResolve) { pendingAbortResolve(); pendingAbortResolve = null; }
    if (thisGenId === generationId) setGenerating(false);
    scrollBottom();
}

function setGenerating(val) {
    isGenerating = val;
    const sendIcon = sendBtn.querySelector('.send-icon');
    const stopIcon = sendBtn.querySelector('.stop-icon');
    if (val) {
        sendBtn.classList.remove('disabled'); sendBtn.classList.add('stop');
        if (sendIcon) sendIcon.style.display = 'none';
        if (stopIcon) stopIcon.style.display = 'block';
        sendBtn.onclick = stopGeneration;
    } else {
        sendBtn.classList.remove('stop');
        if (sendIcon) sendIcon.style.display = 'block';
        if (stopIcon) stopIcon.style.display = 'none';
        sendBtn.onclick = sendMessage;
        toggleSend();
    }
}

async function stopGeneration() {
    if (!isGenerating) return;
    if (window.pywebview?.api) window.pywebview.api.stop_generation();
    generationId++;
    await new Promise(r => { pendingAbortResolve = r; setTimeout(r, 3000); });
    pendingAbortResolve = null;
    setGenerating(false);
    showToast('Generation stopped', 'info');
}

// ══════════════════════════════════════════════════════════
// SUGGESTIONS
// ══════════════════════════════════════════════════════════
function fillSuggestion(el) {
    const title = el.querySelector('.suggestion-title');
    input.value = title ? title.textContent : el.textContent;
    autoResize(input); toggleSend(); input.focus();
}

// ══════════════════════════════════════════════════════════
// ATTACH & COMMAND
// ══════════════════════════════════════════════════════════
function attachFile() {
    if (window.pywebview?.api) {
        window.pywebview.api.open_file_dialog().then(r => {
            if (r) {
                input.value += (input.value ? '\n' : '') + `Please read and analyze this file: ${r}`;
                autoResize(input); toggleSend(); input.focus();
                showToast('File attached', 'success');
            }
        });
    }
}

function quickCommand() {
    const cmd = prompt('Enter a command to run:');
    if (cmd) { input.value = `Run this command: ${cmd}`; autoResize(input); toggleSend(); input.focus(); }
}

// ══════════════════════════════════════════════════════════
// CHAT MANAGEMENT
// ══════════════════════════════════════════════════════════
function newChat() {
    const id = 'chat_' + Date.now();
    conversations.unshift({ id, title: 'New Chat', created: Date.now() });
    saveConversations(); switchChat(id);
    const tt = document.getElementById('topbarTitle');
    if (tt) tt.textContent = 'New Chat';
}

function switchChat(id) {
    currentChatId = id;
    renderChatList();
    const chat = conversations.find(c => c.id === id);
    const tt = document.getElementById('topbarTitle');
    if (tt && chat) tt.textContent = chat.title;

    if (pywebviewReady && window.pywebview?.api) {
        window.pywebview.api.load_chat_messages(id).then(json => {
            currentMessages = JSON.parse(json || '[]'); renderMessages();
        });
    } else {
        loadChatMessages(); renderMessages();
    }
}

function deleteChat(id, e) {
    e.stopPropagation();
    conversations = conversations.filter(c => c.id !== id);
    localStorage.removeItem('cc_msgs_' + id);
    if (window.pywebview?.api) window.pywebview.api.delete_chat_file(id);
    saveConversations();
    if (currentChatId === id) { conversations.length > 0 ? switchChat(conversations[0].id) : newChat(); }
    else renderChatList();
    showToast('Chat deleted', 'info');
}

function renderChatList() {
    chatList.innerHTML = '';
    conversations.forEach(chat => {
        const div = document.createElement('div');
        div.className = 'chat-item' + (chat.id === currentChatId ? ' active' : '');
        div.setAttribute('role', 'listitem');
        const age = getTimeAgo(chat.created);
        div.innerHTML = `<span class="dot"></span><span class="label">${esc(chat.title)}</span><span class="time">${age}</span><button class="delete-chat" onclick="deleteChat('${chat.id}', event)" title="Delete" aria-label="Delete chat">✕</button>`;
        div.onclick = () => switchChat(chat.id);
        chatList.appendChild(div);
    });
}

function getTimeAgo(ts) {
    const d = Date.now() - ts, m = Math.floor(d / 60000);
    if (m < 1) return 'now'; if (m < 60) return m + 'm';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
}

function loadConversations() {
    if (window.pywebview?.api) { window.pywebview.api.load_conversations().then(j => { conversations = JSON.parse(j||'[]'); renderChatList(); }); }
    else { conversations = JSON.parse(localStorage.getItem('cc_conversations') || '[]'); }
}

function saveConversations() {
    const j = JSON.stringify(conversations);
    localStorage.setItem('cc_conversations', j);
    if (window.pywebview?.api) window.pywebview.api.save_conversations(j);
}

function loadChatMessages() {
    if (window.pywebview?.api) { window.pywebview.api.load_chat_messages(currentChatId).then(j => { currentMessages = JSON.parse(j||'[]'); renderMessages(); }); }
    else { const s = localStorage.getItem('cc_msgs_' + currentChatId); currentMessages = s ? JSON.parse(s) : []; }
}

function saveChatMessages() {
    const j = JSON.stringify(currentMessages);
    localStorage.setItem('cc_msgs_' + currentChatId, j);
    if (window.pywebview?.api) window.pywebview.api.save_chat_messages(currentChatId, j);
}

function renderMessages() {
    msgContainer.innerHTML = '';
    if (currentMessages.length === 0) {
        // Re-insert the empty state from the HTML template
        msgContainer.innerHTML = document.querySelector('.empty-state') ? '' : `
            <div class="empty-state" id="emptyState">
                <div class="empty-buddy"><svg class="buddy-svg-lg" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg2" x1="0" y1="0" x2="80" y2="80"><stop offset="0%" stop-color="#B9E7FF"/><stop offset="50%" stop-color="#93D9FF"/><stop offset="100%" stop-color="#6CC4F0"/></linearGradient></defs><rect x="6" y="6" width="68" height="68" rx="22" fill="url(#bg2)"/><circle cx="28" cy="36" r="5.5" fill="#080d11"/><circle cx="52" cy="36" r="5.5" fill="#080d11"/><circle cx="30" cy="33.5" r="2" fill="rgba(255,255,255,0.7)"/><circle cx="54" cy="33.5" r="2" fill="rgba(255,255,255,0.7)"/><path d="M28 52 Q40 62 52 52" stroke="#080d11" stroke-width="3.5" stroke-linecap="round" fill="none"/></svg></div>
                <h1 class="empty-title">What are you building?</h1>
                <p class="empty-sub">I can write code, debug issues, manage files, run commands, and control your system.</p>
                <div class="suggestion-grid">
                    <button class="suggestion-card" onclick="fillSuggestion(this)"><div class="suggestion-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 7l4 4-4 4M10 15h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="suggestion-text"><div class="suggestion-title">Build a REST API</div><div class="suggestion-desc">Express, Flask, FastAPI...</div></div></button>
                    <button class="suggestion-card" onclick="fillSuggestion(this)"><div class="suggestion-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div><div class="suggestion-text"><div class="suggestion-title">Debug my code</div><div class="suggestion-desc">Find and fix issues fast</div></div></button>
                    <button class="suggestion-card" onclick="fillSuggestion(this)"><div class="suggestion-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M6 3h8v14H6z" stroke="currentColor" stroke-width="1.5"/><path d="M9 7h2M9 10h2M9 13h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div><div class="suggestion-text"><div class="suggestion-title">Write unit tests</div><div class="suggestion-desc">pytest, jest, unittest...</div></div></button>
                    <button class="suggestion-card" onclick="fillSuggestion(this)"><div class="suggestion-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 14l4-8 4 5 3-3 3 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="suggestion-text"><div class="suggestion-title">Analyze my project</div><div class="suggestion-desc">Structure, deps, quality</div></div></button>
                    <button class="suggestion-card" onclick="fillSuggestion(this)"><div class="suggestion-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M7 10h6M10 7v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div><div class="suggestion-text"><div class="suggestion-title">Create a new project</div><div class="suggestion-desc">Scaffold from scratch</div></div></button>
                    <button class="suggestion-card" onclick="fillSuggestion(this)"><div class="suggestion-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div><div class="suggestion-text"><div class="suggestion-title">Explain this error</div><div class="suggestion-desc">Paste any stack trace</div></div></button>
                </div>
            </div>`;
        return;
    }

    for (const msg of currentMessages) {
        if (msg.role === 'user' && typeof msg.content === 'string') {
            const div = document.createElement('div');
            div.className = 'message user';
            div.innerHTML = `<div class="msg-bubble">${esc(msg.content)}</div>`;
            msgContainer.appendChild(div);
        } else if (msg.role === 'assistant') {
            const div = document.createElement('div');
            div.className = 'message assistant';
            let textContent = '', toolHtml = '';
            if (typeof msg.content === 'string') { textContent = msg.content; }
            else if (Array.isArray(msg.content)) {
                for (const b of msg.content) {
                    if (b.type === 'text') textContent += b.text;
                    if (b.type === 'tool_use') toolHtml += renderToolCall(b.name, b.input, '(cached)');
                }
            }
            div.innerHTML = `<div class="msg-avatar"><svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="32" height="32" rx="10" fill="url(#maG)"/><circle cx="13" cy="16" r="2.5" fill="#080d11"/><circle cx="23" cy="16" r="2.5" fill="#080d11"/><circle cx="14" cy="14.8" r="1" fill="rgba(255,255,255,0.6)"/><circle cx="24" cy="14.8" r="1" fill="rgba(255,255,255,0.6)"/><path d="M13 23Q18 27 23 23" stroke="#080d11" stroke-width="2" stroke-linecap="round" fill="none"/><defs><linearGradient id="maG" x1="0" y1="0" x2="36" y2="36"><stop stop-color="#B9E7FF"/><stop offset="1" stop-color="#7BC8F6"/></linearGradient></defs></svg></div><div class="msg-body"><div class="msg-name">Claude</div><div class="msg-text">${toolHtml}${renderMarkdown(textContent)}</div></div>`;
            msgContainer.appendChild(div);
        }
    }
    scrollBottom();
}

// ══════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════
function openSettings() {
    document.getElementById('systemPromptInput').value = customSystemPrompt;
    document.getElementById('settingsModal').classList.add('open');
}
function closeSettings() { document.getElementById('settingsModal').classList.remove('open'); }
function closeSettingsOutside(e) { if (e.target === document.getElementById('settingsModal')) closeSettings(); }
function saveSettings() {
    customSystemPrompt = document.getElementById('systemPromptInput').value;
    closeSettings();
    showToast('Settings saved', 'success');
}


// ══════════════════════════════════════════════════════════
// ASK USER (called from Python when AI needs clarification)
// ══════════════════════════════════════════════════════════
function showAskUser(question, options) {
    const msgs = document.querySelectorAll('.message.assistant');
    if (!msgs.length) return;
    const msgText = msgs[msgs.length - 1].querySelector('.msg-text');
    const thinking = msgText.querySelector('.thinking'); if (thinking) thinking.remove();

    const askId = 'ask_' + Date.now();
    let optionsHtml = options.map(o => `<button class="ask-user-option" onclick="pickAskOption('${askId}', this)">${esc(o)}</button>`).join('');

    const askHtml = `<div class="ask-user" id="${askId}">
        <div class="ask-user-question">${esc(question)}</div>
        <div class="ask-user-options">${optionsHtml}</div>
        <div class="ask-user-other">
            <input class="ask-user-input" placeholder="Or type your own answer..." onkeydown="if(event.key==='Enter')submitAskOther('${askId}')">
            <button class="ask-user-submit" onclick="submitAskOther('${askId}')">Send</button>
        </div>
    </div>`;

    const d = document.createElement('div');
    d.innerHTML = askHtml;
    msgText.appendChild(d.firstElementChild);
    scrollBottom();

    // Focus the "Other" input
    const inp = document.querySelector(`#${askId} .ask-user-input`);
    if (inp) inp.focus();
}

function pickAskOption(askId, btn) {
    const answer = btn.textContent;
    const container = document.getElementById(askId);
    if (container) container.classList.add('answered');

    // Send answer to Python
    if (window.pywebview?.api) {
        window.pywebview.api.submit_answer(answer);
    }
    showToast('Answer sent: ' + answer, 'info');
}

function submitAskOther(askId) {
    const container = document.getElementById(askId);
    if (!container) return;
    const inp = container.querySelector('.ask-user-input');
    const answer = inp ? inp.value.trim() : '';
    if (!answer) return;

    container.classList.add('answered');

    if (window.pywebview?.api) {
        window.pywebview.api.submit_answer(answer);
    }
    showToast('Answer sent: ' + answer, 'info');
}

// ══════════════════════════════════════════════════════════
// REAL-TIME UPDATES (called from Python)
// ══════════════════════════════════════════════════════════
function updateToolProgress(name, inp, result, status) {
    const msgs = document.querySelectorAll('.message.assistant');
    if (!msgs.length) return;
    const msgText = msgs[msgs.length - 1].querySelector('.msg-text');
    const thinking = msgText.querySelector('.thinking'); if (thinking) thinking.remove();
    const d = document.createElement('div');
    d.innerHTML = renderToolCall(name, inp, result);
    msgText.appendChild(d.firstElementChild);
    scrollBottom();
}

function updateFinalText(text) {
    const msgs = document.querySelectorAll('.message.assistant');
    if (!msgs.length) return;
    const msgText = msgs[msgs.length - 1].querySelector('.msg-text');
    const thinking = msgText.querySelector('.thinking'); if (thinking) thinking.remove();
    const d = document.createElement('div');
    d.innerHTML = renderMarkdown(text);
    while (d.firstChild) msgText.appendChild(d.firstChild);
    scrollBottom();
}

function showThinking() {
    const msgs = document.querySelectorAll('.message.assistant');
    if (!msgs.length) return;
    const msgText = msgs[msgs.length - 1].querySelector('.msg-text');
    if (!msgText.querySelector('.thinking')) {
        const d = document.createElement('div');
        d.className = 'thinking';
        d.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>Thinking…';
        msgText.appendChild(d); scrollBottom();
    }
}

// ══════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════
init();
