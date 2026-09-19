/* Quist — the design file (Cloud Coding Unit) wired to the API.
   Visuals are the spec: every style string below is the original one. */
const NW = 212, NH = 58;

const LANGS = { js:'javascript', mjs:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', py:'python', rb:'ruby', java:'java', kt:'kotlin', swift:'swift', c:'c', h:'c', cpp:'cpp', cc:'cpp', cxx:'cpp', hpp:'cpp', cs:'csharp', go:'go', rs:'rust', php:'php', lua:'lua', r:'r', dart:'dart', scala:'scala', pl:'perl', sql:'sql', json:'json', yml:'yaml', yaml:'yaml', toml:'ini', ini:'ini', xml:'xml', md:'markdown', css:'css', scss:'scss', html:'html', sh:'shell', bash:'shell', zsh:'shell', dockerfile:'dockerfile', txt:'plaintext' };

const BADGE = {
  javascript:{ l:'JS', c:'#E5C07B' }, typescript:{ l:'TS', c:'#7AA2F7' }, python:{ l:'PY', c:'#6FBF73' },
  cpp:{ l:'C++', c:'#8FA7D4' }, c:{ l:'C', c:'#9AA4B2' }, csharp:{ l:'C#', c:'#A47ED8' }, java:{ l:'JV', c:'#D08B62' },
  go:{ l:'GO', c:'#66C7D9' }, rust:{ l:'RS', c:'#D97757' }, ruby:{ l:'RB', c:'#CF6B6B' }, php:{ l:'PHP', c:'#8F8FD9' },
  swift:{ l:'SW', c:'#E0845C' }, kotlin:{ l:'KT', c:'#B48BE0' }, dart:{ l:'DT', c:'#5FB8C7' }, lua:{ l:'LUA', c:'#7B8FD4' },
  r:{ l:'R', c:'#7FA6D9' }, scala:{ l:'SC', c:'#CF6B6B' }, perl:{ l:'PL', c:'#9AA4B2' },
  html:{ l:'<>', c:'#E08A5C' }, css:{ l:'CSS', c:'#7AA2F7' }, scss:{ l:'SCS', c:'#D98BB4' },
  json:{ l:'{}', c:'#C7A96B' }, yaml:{ l:'YML', c:'#9AA4B2' }, ini:{ l:'INI', c:'#9AA4B2' }, xml:{ l:'XML', c:'#9AA4B2' },
  markdown:{ l:'MD', c:'#BDBDBD' }, shell:{ l:'SH', c:'#7FBF8F' }, sql:{ l:'SQL', c:'#C7A96B' },
  dockerfile:{ l:'DKR', c:'#6FA8D9' }, plaintext:{ l:'TXT', c:'#8A8A8A' }, zig:{ l:'ZIG', c:'#E5C07B' }, makefile:{ l:'MK', c:'#9AA4B2' }, cmake:{ l:'CM', c:'#9AA4B2' }
};

const SEED = {
  javascript: "export async function handler(req, res) {\n  const { id } = req.params;\n  const record = await store.get(id);\n  if (!record) return res.status(404).json({ error: 'not found' });\n  return res.json(record);\n}\n",
  typescript: "type Unit = { id: string; region: string };\n\nexport async function attach(id: string): Promise<Unit> {\n  return { id, region: 'eu-west-1' };\n}\n",
  python: "def main():\n    unit = Unit.attach('cloud')\n    for job in unit.queue():\n        job.run()\n\n\nif __name__ == '__main__':\n    main()\n",
  cpp: "#include <iostream>\n\nint main() {\n    std::cout << \"unit online\\n\";\n    return 0;\n}\n",
  json: "{\n  \"name\": \"unit\",\n  \"version\": \"0.1.0\",\n  \"private\": true\n}\n",
  markdown: "# Notes\n\nDrag a folder's right node onto another node to own it.\n",
  plaintext: "// new file\n"
};

/* CSS text -> React style object, so every style below stays readable as plain CSS */
const s = (css) => {
  const o = {};
  String(css).split(';').forEach(decl => {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const k = decl.slice(0, i).trim();
    const v = decl.slice(i + 1).trim();
    if (!k || !v) return;
    o[k.replace(/-([a-z])/g, (m, p) => p.toUpperCase())] = v;
  });
  return o;
};

/* thin API layer */
async function api(method, path, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await fetch(path, init);
  if (r.status === 401 && !opts.quiet) { location.replace('/login?next=' + encodeURIComponent(location.pathname)); throw new Error('signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || (r.status + ' ' + r.statusText));
  return j;
}
const fmtBytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

class Unit extends React.Component {
  constructor(p) {
    super(p);
    this.state = {
      user: null, booted: false,
      project: null, projectList: [], newProjectName: '',
      nodes: [], edges: [], pan: { x: 0, y: 0 }, contents: {}, canvasW: 0, canvasH: 0,
      menu: null, tab: 'editor', openId: null, editingId: null, editName: '',
      linking: null, cursor: { x: 0, y: 0 },
      versions: [], versionLabel: '',
      mcp: [], connect: null,
      runtime: 'offline',
      toolchains: [], buildTc: 'clang++', buildCmd: '', buildGlob: 'out/app', buildLabel: '', builds: [], buildLogs: {}, openBuild: null, building: false
    };
    this.canvasRef = React.createRef();
    this.editorRef = React.createRef();
    this.termRef = React.createRef();
    this.fileInputRef = React.createRef();
    this.worldRef = React.createRef();   // the pan/transform container (direct-DOM pan)
    this.drag = null;
    this._livePan = null;                // live pan during a drag, committed to state on threshold/mouseup
    this.dirtyContent = new Set();   // node ids with unsaved editor text
    this.pendingPos = new Map();     // node id -> {x,y} waiting for the batched PATCH
    this.flushPositions = debounce(() => this.savePositions(), 300);
    this.saveContent = debounce(() => this.flushContent(), 600);
    this.refreshGraph = debounce(() => this.loadGraph(), 250);
    this.refreshBuilds = debounce(() => this.loadBuilds(), 300);
  }

  /* ---------- boot ---------- */
  componentDidMount() {
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('click', this.closeMenu);
    window.addEventListener('resize', this.fitTerm);
    window.addEventListener('beforeunload', () => { this.flushContent(); this.savePositions(); });
    this.loadMonaco();
    this.boot();
    // Track canvas size for viewport culling (only render nodes that are on screen).
    this.measureCanvas();
    if (window.ResizeObserver && this.canvasRef.current) {
      this.ro = new ResizeObserver(() => this.measureCanvas());
      this.ro.observe(this.canvasRef.current);
    }
  }
  measureCanvas = () => {
    const el = this.canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - this.state.canvasW) > 1 || Math.abs(r.height - this.state.canvasH) > 1) this.setState({ canvasW: r.width, canvasH: r.height });
  };
  componentWillUnmount() {
    if (this.ro) this.ro.disconnect();
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('click', this.closeMenu);
    window.removeEventListener('resize', this.fitTerm);
  }
  componentDidUpdate(pp, ps) {
    if (this.editor && this.state.openId !== this.syncedId) this.syncEditor();
    if (this.editor && this.state.tab === 'editor' && ps.tab !== 'editor') setTimeout(() => this.editor.layout(), 40);
    if (this.state.project && (!ps.project || ps.project.id !== this.state.project.id)) this.connectTerminal();
  }

  async boot() {
    try {
      const me = await api('GET', '/api/me');
      const { projects } = await api('GET', '/api/projects');
      const [tc, tools] = await Promise.all([api('GET', '/api/toolchains'), api('GET', '/api/mcp/tools')]);
      this.setState({ user: me.user, projectList: projects, booted: true, toolchains: tc.toolchains, mcp: tools.tools.map(t => ({ ...t, on: true })) });
      const m = location.pathname.match(/^\/p\/([0-9a-f-]{36})$/);
      const want = m ? m[1] : localStorage.getItem('quist:last');
      const pick = projects.find(p => p.id === want) || null;
      if (pick) this.openProject(pick);
    } catch (e) { /* redirected to /login by api() */ }
  }

  /* ---------- monaco ---------- */
  loadMonaco() {
    const start = () => {
      window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
      window.require(['vs/editor/editor.main'], () => {
        window.monaco.editor.defineTheme('unit', {
          base: 'vs-dark', inherit: true,
          rules: [
            { token: '', foreground: 'E4E4E4' },
            { token: 'comment', foreground: '6E6E6E', fontStyle: 'italic' },
            { token: 'keyword', foreground: 'D97757' },
            { token: 'keyword.control', foreground: 'D97757' },
            { token: 'keyword.operator', foreground: 'D97757' },
            { token: 'keyword.json', foreground: 'E8916F' },
            { token: 'storage', foreground: 'D97757' },
            { token: 'storage.type', foreground: 'D97757' },
            { token: 'constant', foreground: 'E8916F' },
            { token: 'constant.language', foreground: 'D97757' },
            { token: 'number', foreground: 'E8916F' },
            { token: 'string', foreground: 'B9B29F' },
            { token: 'string.escape', foreground: 'E8916F' },
            { token: 'regexp', foreground: 'B9B29F' },
            { token: 'type', foreground: 'EFC7B2' },
            { token: 'type.identifier', foreground: 'EFC7B2' },
            { token: 'entity.name.type', foreground: 'EFC7B2' },
            { token: 'identifier', foreground: 'E4E4E4' },
            { token: 'variable', foreground: 'E4E4E4' },
            { token: 'variable.predefined', foreground: 'EFC7B2' },
            { token: 'function', foreground: 'F0B392' },
            { token: 'support.function', foreground: 'F0B392' },
            { token: 'attribute.name', foreground: 'F0B392' },
            { token: 'attribute.value', foreground: 'B9B29F' },
            { token: 'tag', foreground: 'D97757' },
            { token: 'metatag', foreground: 'D97757' },
            { token: 'annotation', foreground: 'A08C7D' },
            { token: 'delimiter', foreground: '9A9A9A' },
            { token: 'delimiter.bracket', foreground: 'B4B4B4' },
            { token: 'operator', foreground: 'C7C7C7' },
            { token: 'namespace', foreground: 'EFC7B2' },
            { token: 'key', foreground: 'F0B392' },
            { token: 'invalid', foreground: 'C25B4A' }
          ],
          colors: {
            'editor.background': '#161616', 'editorGutter.background': '#161616',
            'editorLineNumber.foreground': '#4A4A4A', 'editorLineNumber.activeForeground': '#D97757',
            'editor.lineHighlightBackground': '#1C1C1C', 'editorCursor.foreground': '#D97757',
            'editor.selectionBackground': '#D9775733', 'editorIndentGuide.background': '#232323',
            'editorIndentGuide.activeBackground': '#3A3A3A', 'editorBracketMatch.background': '#D9775722',
            'editorBracketMatch.border': '#D97757', 'editorWhitespace.foreground': '#2A2A2A',
            'editorWidget.background': '#1A1A1A', 'editorSuggestWidget.background': '#1A1A1A',
            'editorSuggestWidget.selectedBackground': '#262626', 'editorHoverWidget.background': '#1A1A1A'
          }
        });
        if (!this.editorRef.current) return;
        this.editor = window.monaco.editor.create(this.editorRef.current, {
          value: '', language: 'plaintext', theme: 'unit', automaticLayout: true,
          fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, lineHeight: 21,
          minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 14, bottom: 14 },
          roundedSelection: true, smoothScrolling: true,
          tabSize: 2, insertSpaces: true, detectIndentation: true, autoIndent: 'full',
          formatOnType: true, formatOnPaste: true, autoClosingBrackets: 'always', autoClosingQuotes: 'always',
          autoSurround: 'languageDefined', matchBrackets: 'always',
          bracketPairColorization: { enabled: false },
          guides: { indentation: true, bracketPairs: false, highlightActiveIndentation: true },
          renderWhitespace: 'selection', wordWrap: 'on', cursorSmoothCaretAnimation: 'on',
          suggestOnTriggerCharacters: true, quickSuggestions: true, occurrencesHighlight: true,
          scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9, useShadows: false }
        });
        this.editor.onDidChangeModelContent(() => {
          const id = this.state.openId;
          if (!id || this.settingValue) return;
          const v = this.editor.getValue();
          this.dirtyContent.add(id);
          this.setState(st => ({ contents: { ...st.contents, [id]: v } }));
          this.saveContent();
        });
        this.syncedId = undefined;
        this.syncEditor();
      });
    };
    if (window.require && window.require.config) start();
    else this.mTimer = setInterval(() => { if (window.require && window.require.config) { clearInterval(this.mTimer); start(); } }, 120);
  }

  setEditorValue(v) {
    this.settingValue = true;
    try { if (this.editor.getValue() !== v) this.editor.setValue(v); } finally { this.settingValue = false; }
  }
  syncEditor() {
    if (!this.editor || !window.monaco) return;
    const n = this.node(this.state.openId);
    const v = n ? (this.state.contents[n.id] !== undefined ? this.state.contents[n.id] : '') : '';
    this.setEditorValue(v);
    this.applyLang(n && n.lang);
    this.syncedId = this.state.openId;
    setTimeout(() => this.editor && this.editor.layout(), 20);
  }
  async openFile(id) {
    const n = this.node(id);
    if (!n || n.kind !== 'file') return;
    if (this.state.contents[id] === undefined) {
      try {
        const { node } = await api('GET', '/api/nodes/' + id);
        if (node.content === null) { this.log(n.name + ' is binary — download it instead', 'err'); return; }
        this.setState(st => ({ contents: { ...st.contents, [id]: node.content } }));
      } catch (e) { this.log('open: ' + e.message, 'err'); return; }
    }
    this.setState({ openId: id, tab: 'editor' }, () => this.syncEditor());
  }
  applyLang(lang) {
    const l = lang || 'plaintext';
    window.monaco.editor.setModelLanguage(this.editor.getModel(), l);
    this.editor.updateOptions({ tabSize: ['python', 'go', 'php', 'java', 'csharp'].includes(l) ? 4 : 2, insertSpaces: l !== 'go' });
  }
  async flushContent() {
    if (!this.dirtyContent.size) return;
    const ids = [...this.dirtyContent];
    this.dirtyContent.clear();
    for (const id of ids) {
      const v = this.state.contents[id];
      if (v === undefined || !this.node(id)) continue;
      try { await api('PATCH', '/api/nodes/' + id, { content: v }); }
      catch (e) { this.dirtyContent.add(id); this.log('save failed: ' + e.message, 'err'); }
    }
  }

  /* ---------- graph state ---------- */
  node(id) { return this.state.nodes.find(n => n.id === id); }
  kids(id) { return this.state.edges.filter(e => e.from === id).map(e => this.node(e.to)).filter(Boolean); }

  async loadGraph() {
    // Use the id tracked synchronously in openProject, not this.state.project,
    // which may not have flushed yet when loadGraph is awaited right after setState.
    const pid = this.currentProjectId || (this.state.project && this.state.project.id);
    if (!pid) return;
    try {
      const { project, nodes, edges } = await api('GET', '/api/projects/' + pid);
      if (this.currentProjectId && this.currentProjectId !== pid) return; // switched away mid-flight
      this.setState(st => {
        if (st.project && st.project.id !== pid) return {}; // stale response for a closed project
        const dragging = this.drag && this.drag.kind === 'node' ? this.drag.id : null;
        const localById = new Map(st.nodes.map(m => [m.id, m])); // avoid O(n^2) find
        let openStillThere = false;
        const merged = nodes.map(n => {
          if (n.id === st.openId) openStillThere = true;
          const local = localById.get(n.id);
          if ((this.pendingPos.has(n.id) || dragging === n.id) && local) return { ...n, x: local.x, y: local.y };
          return n;
        });
        const contents = {};
        for (const n of merged) if (st.contents[n.id] !== undefined) contents[n.id] = st.contents[n.id];
        return { nodes: merged, edges, contents, project: { ...st.project, mcp_disabled: project.mcp_disabled }, openId: openStillThere ? st.openId : null,
          mcp: st.mcp.map(t => ({ ...t, on: !(project.mcp_disabled || []).includes(t.name) })) };
      });
    } catch (e) { this.log('sync: ' + e.message, 'err'); }
  }

  async openProject(p) {
    if (this.currentProjectId === p.id) return;
    this.currentProjectId = p.id;
    await this.flushContent();
    this.setState({ project: p, nodes: [], edges: [], contents: {}, openId: null, versions: [], builds: [], buildLogs: {}, openBuild: null, connect: null, pan: { x: 0, y: 0 } });
    localStorage.setItem('quist:last', p.id);
    history.replaceState(null, '', '/p/' + p.id);
    await this.loadGraph();
    this.loadVersions();
    this.loadBuilds();
  }

  async createProjectFn() {
    const name = (this.state.newProjectName || '').trim() || 'untitled-unit';
    try {
      const { project } = await api('POST', '/api/projects', { name });
      this.setState(st => ({ projectList: [...st.projectList, project], newProjectName: '' }));
      await this.openProject(project);
      this.log('project ' + name + ' initialised', 'ok');
    } catch (e) { this.log('project: ' + e.message, 'err'); }
  }

  async deleteProject(p) {
    if (!confirm('Delete project "' + p.name + '" and every node in it? This cannot be undone.')) return;
    try {
      await api('DELETE', '/api/projects/' + p.id);
      const wasCurrent = this.currentProjectId === p.id;
      if (wasCurrent) this.currentProjectId = null;
      this.setState(st => ({ projectList: st.projectList.filter(x => x.id !== p.id), menu: null,
        ...(st.project && st.project.id === p.id ? { project: null, nodes: [], edges: [], openId: null } : {}) }));
      if (wasCurrent) { history.replaceState(null, '', '/'); localStorage.removeItem('quist:last'); this.disconnectTerminal(); }
    } catch (e) { this.log('delete: ' + e.message, 'err'); }
  }

  async signOut() { await this.flushContent(); await api('POST', '/api/auth/logout'); location.replace('/login'); }

  /* ---------- terminal (xterm over ws) ---------- */
  log = (t, k) => {
    if (!this.term) return;
    const color = { cmd: '38;2;237;237;237', ok: '38;2;217;119;87', err: '38;2;194;91;74', dim: '38;2;110;110;110' }[k] || '38;2;154;154;154';
    this.term.write('\r\n\x1b[' + color + 'm' + t + '\x1b[0m\r\n');
    if (this.state.runtime === 'ready') this.term.write('\x1b[38;2;217;119;87m~/' + (this.state.project ? this.state.project.name : '') + ' $\x1b[0m ');
  };

  initTerm() {
    if (this.term || !this.termRef.current || !window.Terminal) return;
    this.term = new window.Terminal({
      fontFamily: 'JetBrains Mono, monospace', fontSize: 12, lineHeight: 1.35, cursorBlink: true, cursorStyle: 'bar', scrollback: 4000,
      allowProposedApi: true,
      theme: { background: '#0D0D0D', foreground: '#EDEDED', cursor: '#D97757', cursorAccent: '#0D0D0D', selectionBackground: '#D9775744',
        black: '#1B1B1B', brightBlack: '#6E6E6E', red: '#C25B4A', brightRed: '#C25B4A', green: '#D97757', brightGreen: '#E8916F',
        yellow: '#EFC7B2', brightYellow: '#EFC7B2', blue: '#9A9A9A', brightBlue: '#B4B4B4', magenta: '#D97757', brightMagenta: '#E8916F',
        cyan: '#B9B29F', brightCyan: '#B9B29F', white: '#EDEDED', brightWhite: '#FFFFFF' }
    });
    this.fit = new window.FitAddon.FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(this.termRef.current);
    this.lineBuf = '';
    this.term.onData(d => {
      if (!this.ws || this.ws.readyState !== 1) return;
      if (this.state.runtime !== 'ready') { this.send({ t: 'restart', cols: this.term.cols, rows: this.term.rows }); return; }
      if (this.pipeMode) { // no pty: local echo + line mode
        if (d === '\r') { this.term.write('\r\n'); this.send({ t: 'in', d: this.lineBuf + '\n' }); this.lineBuf = ''; }
        else if (d === '\x7f') { if (this.lineBuf.length) { this.lineBuf = this.lineBuf.slice(0, -1); this.term.write('\b \b'); } }
        else { this.lineBuf += d; this.term.write(d); }
        return;
      }
      this.send({ t: 'in', d });
    });
    this.term.onResize(({ cols, rows }) => this.send({ t: 'resize', cols, rows }));
    setTimeout(this.fitTerm, 30);
  }
  fitTerm = () => { try { this.fit && this.fit.fit(); } catch (e) { /* hidden */ } };
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  connectTerminal() {
    this.initTerm();
    this.disconnectTerminal();
    const p = this.state.project;
    if (!p || !this.term) return;
    this.term.reset();
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(proto + location.host + '/ws/terminal/' + p.id);
    this.ws = ws;
    ws.onopen = () => { this.fitTerm(); this.send({ t: 'resize', cols: this.term.cols, rows: this.term.rows }); };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'out') this.term.write(m.d);
      else if (m.t === 'replay') { this.term.reset(); if (m.d) this.term.write(m.d); }
      else if (m.t === 'cleared') this.term.reset();
      else if (m.t === 'status') { this.pipeMode = !!m.pipe; this.setState({ runtime: m.running ? 'ready' : 'offline' }); }
      else if (m.t === 'exit') { this.setState({ runtime: 'offline' }); this.term.write('\r\n\x1b[38;2;110;110;110m[shell exited' + (m.code != null ? ' ' + m.code : '') + ' — press any key to restart]\x1b[0m\r\n'); }
      else if (m.t === 'open') this.openFile(m.nodeId);
      else if (m.t === 'graph') this.onGraphEvent(m.ev);
    };
    ws.onclose = () => { if (this.ws === ws) { this.setState({ runtime: 'offline' }); this.reconnect = setTimeout(() => { if (this.state.project && this.state.project.id === p.id) this.connectTerminal(); }, 2500); } };
    this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 25000);
  }
  disconnectTerminal() {
    clearTimeout(this.reconnect); clearInterval(this.pingTimer);
    if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch (e) { /* closed */ } }
  }

  // A change made by the shell, the MCP server, or another tab. Keep the canvas truthful.
  onGraphEvent(ev) {
    if (ev.type === 'node.updated' && ev.changed && ev.changed.oldName === undefined && ev.changed.content === undefined && ev.changed.size === undefined) {
      const dragging = this.drag && this.drag.kind === 'node' && this.drag.id === ev.node.id;
      if (!dragging && !this.pendingPos.has(ev.node.id)) this.setState(st => ({ nodes: st.nodes.map(n => n.id === ev.node.id ? { ...n, x: ev.node.x, y: ev.node.y } : n) }));
      return;
    }
    if (ev.type === 'node.updated' && ev.changed && (ev.changed.content !== undefined || ev.changed.size !== undefined)) {
      const id = ev.node.id;
      if (!this.dirtyContent.has(id) && this.state.contents[id] !== undefined) {
        api('GET', '/api/nodes/' + id).then(({ node }) => {
          if (this.dirtyContent.has(id) || node.content === null) return;
          this.setState(st => ({ contents: { ...st.contents, [id]: node.content } }), () => { if (this.state.openId === id) this.setEditorValue(node.content); });
        }).catch(() => {});
      }
    }
    if (ev.type === 'graph.replaced') { this.dirtyContent.clear(); this.setState({ contents: {}, openId: null }); if (this.editor) this.setEditorValue(''); }
    this.refreshGraph();
  }

  /* ---------- canvas interaction ---------- */
  worldPt = (e) => {
    const r = this.canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left - this.state.pan.x, y: e.clientY - r.top - this.state.pan.y };
  };
  closeMenu = () => { if (this.state.menu) this.setState({ menu: null }); };
  onCanvasContext = (e) => {
    if (!this.state.project) return;
    e.preventDefault(); e.stopPropagation();
    const r = this.canvasRef.current.getBoundingClientRect();
    this.setState({ menu: { x: e.clientX - r.left, y: e.clientY - r.top, world: this.worldPt(e), target: null } });
  };
  onCanvasMouseDown = (e) => {
    if (e.button !== 0) return;
    this.setState({ menu: null });
    this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: this.state.pan.x, oy: this.state.pan.y };
  };
  onMove = (e) => {
    if (this.state.linking) { this.setState({ cursor: this.worldPt(e) }); return; }
    if (!this.drag) return;
    if (this.drag.kind === 'pan') {
      // Pan via direct DOM writes (no React) so it's smooth with thousands of
      // nodes; commit to state only when we've moved far enough to re-cull.
      const x = this.drag.ox + e.clientX - this.drag.sx, y = this.drag.oy + e.clientY - this.drag.sy;
      this._livePan = { x, y };
      if (this.worldRef.current) this.worldRef.current.style.transform = `translate(${x}px, ${y}px)`;
      if (this.canvasRef.current) this.canvasRef.current.style.backgroundPosition = `${x % 22}px ${y % 22}px`;
      if (Math.abs(x - this.state.pan.x) > 240 || Math.abs(y - this.state.pan.y) > 240) this.setState({ pan: { x, y } });
    } else {
      const dx = e.clientX - this.drag.sx, dy = e.clientY - this.drag.sy, id = this.drag.id;
      const x = this.drag.ox + dx, y = this.drag.oy + dy;
      this.pendingPos.set(id, { x, y });
      this.setState(st => ({ nodes: st.nodes.map(n => n.id === id ? { ...n, x, y } : n) }));
    }
  };
  onUp = () => {
    if (this.drag && this.drag.kind === 'pan' && this._livePan) { this.setState({ pan: this._livePan }); this._livePan = null; }
    if (this.drag && this.drag.kind === 'node') this.flushPositions();
    this.drag = null;
    if (this.state.linking) this.setState({ linking: null });
  };
  async savePositions() {
    if (!this.pendingPos.size || !this.state.project) return;
    const positions = [...this.pendingPos.entries()].map(([id, p]) => ({ id, x: Math.round(p.x), y: Math.round(p.y) }));
    this.pendingPos.clear();
    try { await api('PATCH', '/api/projects/' + this.state.project.id + '/positions', { positions }); }
    catch (e) { this.log('position save failed: ' + e.message, 'err'); }
  }

  freeSpot = (x, y) => {
    let px = x, py = y, guard = 0;
    const hit = () => this.state.nodes.some(n => Math.abs(n.x - px) < NW + 16 && Math.abs(n.y - py) < NH + 16);
    while (hit() && guard++ < 60) { px += 26; py += NH + 18; }
    return { x: px, y: py };
  };
  uniqueName = (base, parentId) => {
    const sib = new Set(this.state.nodes.filter(n => (this.state.edges.find(e => e.to === n.id) || {}).from === parentId).map(n => n.name));
    if (!sib.has(base)) return base;
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
    for (let i = 2; i < 1000; i++) if (!sib.has(stem + '-' + i + ext)) return stem + '-' + i + ext;
    return base + '-' + Date.now();
  };
  create = async (kind, world, name) => {
    const nm = this.uniqueName(name || (kind === 'folder' ? 'new-folder' : 'untitled.ts'), undefined);
    const lang = kind === 'file' ? (LANGS[nm.split('.').pop().toLowerCase()] || 'plaintext') : null;
    const sp = this.freeSpot(world.x - NW / 2, world.y - NH / 2);
    const content = kind === 'file' ? (SEED[lang] || SEED.plaintext) : undefined;
    this.setState({ menu: null });
    try {
      const { node } = await api('POST', '/api/projects/' + this.state.project.id + '/nodes', { kind, name: nm, x: Math.round(sp.x), y: Math.round(sp.y), content });
      this.setState(st => ({
        nodes: [...st.nodes.filter(n => n.id !== node.id), node],
        contents: kind === 'file' ? { ...st.contents, [node.id]: content } : st.contents,
        editingId: name ? null : node.id, editName: node.name,
        openId: kind === 'file' ? node.id : st.openId, tab: kind === 'file' ? 'editor' : st.tab
      }), () => this.syncEditor());
      this.log((kind === 'folder' ? 'mkdir ' : 'touch ') + nm, 'dim');
    } catch (e) { this.log((kind === 'folder' ? 'mkdir: ' : 'touch: ') + e.message, 'err'); }
  };
  commitRename = async () => {
    const id = this.state.editingId, name = (this.state.editName || '').trim();
    const n = this.node(id);
    this.setState({ editingId: null });
    if (!n || !name || name === n.name) return;
    try {
      const { node } = await api('PATCH', '/api/nodes/' + id, { name });
      this.setState(st => ({ nodes: st.nodes.map(m => m.id === id ? { ...m, name: node.name, lang: node.lang } : m) }), () => { if (this.state.openId === id) this.applyLang(node.lang); });
    } catch (e) { this.log('rename: ' + e.message, 'err'); }
  };
  del = async (id) => {
    const n = this.node(id);
    this.setState({ menu: null });
    if (!n) return;
    const cascade = n.kind === 'folder' && this.kids(id).length > 0 && confirm('Delete "' + n.name + '/" and everything it owns? Cancel keeps the children as roots.');
    try {
      const { removed } = await api('DELETE', '/api/nodes/' + id + (cascade ? '?cascade=1' : ''));
      this.dirtyContent.delete(id);
      this.setState(st => ({
        nodes: st.nodes.filter(x => !removed.includes(x.id)),
        edges: st.edges.filter(e => !removed.includes(e.from) && !removed.includes(e.to)),
        openId: removed.includes(st.openId) ? null : st.openId
      }));
      this.log('rm ' + n.name, 'dim');
    } catch (e) { this.log('rm: ' + e.message, 'err'); }
  };
  unlink = async (id) => {
    this.setState({ menu: null });
    try {
      await api('POST', '/api/nodes/' + id + '/unlink');
      this.setState(st => ({ edges: st.edges.filter(e => e.to !== id) }));
    } catch (e) { this.log('unlink: ' + e.message, 'err'); }
  };

  startLink = (e, id) => { e.stopPropagation(); e.preventDefault(); this.setState({ linking: { from: id }, cursor: this.worldPt(e), menu: null }); };
  endLink = async (e, id) => {
    e.stopPropagation();
    const L = this.state.linking;
    if (!L || L.from === id) return;
    const from = this.node(L.from), to = this.node(id);
    if (!from || from.kind !== 'folder' || !to) { this.setState({ linking: null }); return; }
    let cur = L.from; const seen = new Set();
    while (cur) {
      if (cur === id) { this.log('link refused — would create a cycle', 'err'); this.setState({ linking: null }); return; }
      if (seen.has(cur)) break;
      seen.add(cur);
      const up = this.state.edges.find(x => x.to === cur);
      cur = up && up.from;
    }
    this.setState({ linking: null });
    try {
      const { edge } = await api('POST', '/api/projects/' + this.state.project.id + '/edges', { from: L.from, to: id });
      this.setState(st => ({ edges: [...st.edges.filter(x => x.to !== id), edge] }));
      this.log('link ' + from.name + ' > ' + to.name, 'ok');
    } catch (err) { this.log('link refused — ' + err.message, 'err'); }
  };

  treeText = () => {
    // Build child lists once (O(n)) instead of scanning edges per node (O(n^2)).
    const byId = new Map(this.state.nodes.map(n => [n.id, n]));
    const owned = new Set();
    const childrenOf = new Map();
    for (const e of this.state.edges) {
      if (!byId.has(e.from) || !byId.has(e.to)) continue;
      owned.add(e.to);
      (childrenOf.get(e.from) || childrenOf.set(e.from, []).get(e.from)).push(byId.get(e.to));
    }
    const cmp = (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1);
    for (const arr of childrenOf.values()) arr.sort(cmp);
    const roots = this.state.nodes.filter(n => !owned.has(n.id)).sort(cmp);
    if (!roots.length) return '(no nodes yet)';
    const walk = (n, pre, last, top) => {
      let out = pre + (top ? '' : (last ? '└─ ' : '├─ ')) + n.name + (n.kind === 'folder' ? '/' : '');
      const ks = childrenOf.get(n.id) || [];
      ks.forEach((k, i) => { out += '\n' + walk(k, pre + (top ? '' : (last ? '   ' : '│  ')), i === ks.length - 1, false); });
      return out;
    };
    return roots.map(r => walk(r, '', true, true)).join('\n');
  };

  /* ---------- versions ---------- */
  async loadVersions() { try { const { versions } = await api('GET', '/api/projects/' + this.state.project.id + '/versions'); this.setState({ versions }); } catch (e) { /* ignore */ } }
  async saveVersionFn() {
    await this.flushContent();
    try {
      const { version } = await api('POST', '/api/projects/' + this.state.project.id + '/versions', { label: this.state.versionLabel });
      this.setState(st => ({ versions: [version, ...st.versions], versionLabel: '' }));
      this.log('version ' + version.label + ' pinned — ' + version.files + ' files', 'ok');
    } catch (e) { this.log('version: ' + e.message, 'err'); }
  }
  async revertVersion(v) {
    if (!confirm('Revert every file to "' + v.label + '"? Unsaved edits are lost.')) return;
    this.dirtyContent.clear();
    try {
      await api('POST', '/api/versions/' + v.id + '/revert');
      this.setState({ contents: {}, openId: null });
      if (this.editor) this.setEditorValue('');
      await this.loadGraph();
      this.log('reverted graph to ' + v.label, 'ok');
    } catch (e) { this.log('revert: ' + e.message, 'err'); }
  }

  /* ---------- mcp ---------- */
  async toggleTool(name) {
    const p = this.state.project;
    const disabled = new Set(p.mcp_disabled || []);
    disabled.has(name) ? disabled.delete(name) : disabled.add(name);
    this.setState(st => ({ mcp: st.mcp.map(t => t.name === name ? { ...t, on: !disabled.has(name) } : t), project: { ...st.project, mcp_disabled: [...disabled] } }));
    try { await api('PATCH', '/api/projects/' + p.id, { mcp_disabled: [...disabled] }); } catch (e) { this.log('mcp: ' + e.message, 'err'); }
  }
  async connectClaude() {
    try {
      const t = await api('POST', '/api/tokens', { name: 'claude-code' });
      this.setState({ connect: { token: t.token, prefix: t.prefix } });
    } catch (e) { this.log('token: ' + e.message, 'err'); }
  }
  connectConfig() {
    const c = this.state.connect;
    return JSON.stringify({ mcpServers: { quist: { command: 'node', args: ['quist-mcp.js'], env: { QUIST_URL: location.origin, QUIST_TOKEN: c ? c.token : 'qst_…', QUIST_PROJECT: this.state.project ? this.state.project.id : '' } } } }, null, 2);
  }

  /* ---------- builds ---------- */
  async loadBuilds() {
    if (!this.state.project) return;
    try { const { builds } = await api('GET', '/api/projects/' + this.state.project.id + '/builds'); this.setState({ builds }); } catch (e) { /* ignore */ }
  }
  connectBuilds() {
    if (this.bws) { try { this.bws.close(); } catch (e) { /* closed */ } }
    const p = this.state.project;
    if (!p) return;
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(proto + location.host + '/ws/build/' + p.id);
    this.bws = ws;
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'log') this.setState(st => ({ buildLogs: { ...st.buildLogs, [m.id]: (st.buildLogs[m.id] || '') + m.d } }));
      else if (m.t === 'build') {
        this.setState(st => ({ builds: st.builds.some(b => b.id === m.build.id) ? st.builds.map(b => b.id === m.build.id ? { ...b, ...m.build } : b) : [m.build, ...st.builds] }));
        if (m.build.status === 'succeeded' || m.build.status === 'failed') { this.refreshBuilds(); this.log('build ' + m.build.id.slice(0, 8) + ' ' + m.build.status, m.build.status === 'succeeded' ? 'ok' : 'err'); }
      }
    };
    ws.onclose = () => { if (this.bws === ws) setTimeout(() => { if (this.state.project && this.state.project.id === p.id) this.connectBuilds(); }, 3000); };
  }
  async startBuild() {
    await this.flushContent();
    const tc = this.state.toolchains.find(t => t.id === this.state.buildTc);
    this.setState({ building: true });
    try {
      const { build } = await api('POST', '/api/projects/' + this.state.project.id + '/builds', {
        toolchain: this.state.buildTc, command: this.state.buildCmd || (tc && tc.command), artifact_glob: this.state.buildGlob, label: this.state.buildLabel });
      this.setState(st => ({ builds: [build, ...st.builds.filter(b => b.id !== build.id)], openBuild: build.id, buildLogs: { ...st.buildLogs, [build.id]: '' } }));
      this.log('queued build ' + build.id.slice(0, 8) + ' (' + build.toolchain + ')', 'dim');
    } catch (e) { this.log('build: ' + e.message, 'err'); }
    this.setState({ building: false });
  }
  async openBuildLog(id) {
    if (this.state.openBuild === id) { this.setState({ openBuild: null }); return; }
    this.setState({ openBuild: id });
    if (this.state.buildLogs[id] === undefined) {
      try { const { build } = await api('GET', '/api/builds/' + id + '?log=1'); this.setState(st => ({ buildLogs: { ...st.buildLogs, [id]: build.log } })); } catch (e) { /* ignore */ }
    }
  }
  pickToolchain(id) {
    const tc = this.state.toolchains.find(t => t.id === id);
    this.setState({ buildTc: id, buildCmd: tc ? tc.command : '', buildGlob: tc ? tc.artifacts : '' });
  }

  /* ---------- upload ---------- */
  onUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !this.state.project) return;
    const base = this.dropAt || { x: 140 - this.state.pan.x, y: 120 - this.state.pan.y };
    const fd = new FormData();
    files.forEach(f => { fd.append('files', f, f.name); fd.append('paths', f.webkitRelativePath || f.name); });
    fd.append('x', Math.round(base.x - NW / 2)); fd.append('y', Math.round(base.y - NH / 2));
    try {
      const r = await api('POST', '/api/projects/' + this.state.project.id + '/upload', fd);
      await this.loadGraph();
      this.log('uploaded ' + r.created + ' file(s)' + (r.folders ? ' (' + r.folders + ' folders)' : ''), 'ok');
    } catch (err) { this.log('upload: ' + err.message, 'err'); }
  };

  /* ---------- render ---------- */
  computeMenuItems(S) {
    const menuItems = [];
    if (!S.menu) return menuItems;
    if (S.menu.project) {
      const p = S.menu.project;
      menuItems.push({ glyph: '▸', label: 'Open project', action: () => { this.setState({ menu: null }); this.openProject(p); } });
      menuItems.push({ glyph: '×', label: 'Delete project', action: () => this.deleteProject(p) });
    } else if (S.menu.target) {
      const t = this.node(S.menu.target);
      if (t && t.kind === 'file') menuItems.push({ glyph: '▸', label: 'Open in editor', action: () => { this.setState({ menu: null }); this.openFile(t.id); } });
      if (t && t.kind === 'file') menuItems.push({ glyph: '↓', label: 'Download', action: () => { this.setState({ menu: null }); window.open('/api/nodes/' + t.id + '/download', '_blank'); } });
      menuItems.push({ glyph: '✎', label: 'Rename', action: () => this.setState({ editingId: S.menu.target, editName: t ? t.name : '', menu: null }) });
      if (S.edges.some(e => e.to === S.menu.target)) menuItems.push({ glyph: '⌫', label: 'Unlink from owner', action: () => this.unlink(S.menu.target) });
      menuItems.push({ glyph: '×', label: 'Delete node', action: () => this.del(S.menu.target) });
    } else {
      menuItems.push({ glyph: '+', label: 'Create file', action: () => this.create('file', S.menu.world) });
      menuItems.push({ glyph: '+', label: 'Create folder', action: () => this.create('folder', S.menu.world) });
      menuItems.push({ glyph: '↑', label: 'Upload from disk', action: () => { this.dropAt = S.menu.world; this.setState({ menu: null }); this.fileInputRef.current && this.fileInputRef.current.click(); } });
      menuItems.push({ glyph: '⤢', label: 'Reset view', action: () => { this._livePan = null; this.setState({ pan: { x: 0, y: 0 }, menu: null }); } });
    }
    return menuItems;
  }

  // The canvas subtree is expensive (culling, thousands of nodes) but only
  // depends on graph/pan/menu state — not the editor, terminal or build panes.
  // Memoize it so a keystroke or a stream of log lines never re-renders it.
  memoCanvas(S) {
    const sig = [S.nodes, S.edges, S.pan, S.canvasW, S.canvasH, S.openId, S.editingId, S.editName,
      S.linking, S.linking ? S.cursor : null, S.menu, S.project, S.booted, S.newProjectName, this.drag];
    if (this._csig && this._csig.length === sig.length && this._csig.every((v, i) => v === sig[i])) return this._cel;
    this._csig = sig;
    this._cel = this.buildCanvas(S);
    return this._cel;
  }

  buildCanvas(S) {
    const pos = n => ({ ix: n.x, iy: n.y + NH / 2, ox: n.x + NW, oy: n.y + NH / 2 });
    const curve = (x1, y1, x2, y2) => {
      const back = x2 < x1 + 60;
      const dx = back ? Math.max(90, Math.abs(x2 - x1) * 0.7) : Math.max(48, (x2 - x1) * 0.5);
      return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    };
    const arrow = (x, y) => `M ${x - 9} ${y - 4.5} L ${x - 2.5} ${y} L ${x - 9} ${y + 4.5}`;
    const PAD = 500;
    const vx0 = -S.pan.x - PAD, vy0 = -S.pan.y - PAD;
    const vx1 = -S.pan.x + (S.canvasW || 1200) + PAD, vy1 = -S.pan.y + (S.canvasH || 800) + PAD;
    const onScreen = n => n.x + NW >= vx0 && n.x <= vx1 && n.y + NH >= vy0 && n.y <= vy1;
    const nodeById = new Map(S.nodes.map(n => [n.id, n]));
    const dragId = this.drag && this.drag.kind === 'node' ? this.drag.id : null;
    const forceShow = id => id === S.openId || id === S.editingId || id === dragId;
    const ownedSet = new Set(S.edges.map(e => e.to));
    const childCount = new Map();
    for (const e of S.edges) childCount.set(e.from, (childCount.get(e.from) || 0) + 1);

    const edges = S.edges.map((e, i) => {
      const a = nodeById.get(e.from), b = nodeById.get(e.to);
      if (!a || !b) return null;
      const minx = Math.min(a.x, b.x), maxx = Math.max(a.x + NW, b.x + NW);
      const miny = Math.min(a.y, b.y), maxy = Math.max(a.y + NH, b.y + NH);
      if (maxx < vx0 || minx > vx1 || maxy < vy0 || miny > vy1) return null;
      const p1 = pos(a), p2 = pos(b);
      return { key: e.from + '>' + e.to + i, d: curve(p1.ox, p1.oy, p2.ix, p2.iy), head: arrow(p2.ix, p2.iy), color: b.kind === 'folder' ? '#D97757' : '#5A5A5A' };
    }).filter(Boolean);

    let dragPath = null;
    if (S.linking) { const a = nodeById.get(S.linking.from); if (a) { const p = pos(a); dragPath = curve(p.ox, p.oy, S.cursor.x, S.cursor.y); } }

    const portS = (side, lit) => `position:absolute; top:${NH / 2 - 6}px; ${side}:-6px; width:12px; height:12px; border-radius:999px; background:${lit ? '#D97757' : '#1B1B1B'}; box-shadow:0 0 0 2px #0F0F0F, 0 0 0 3.5px ${lit ? '#D97757' : '#3A3A3A'}; cursor:crosshair; z-index:4;`;
    const menuItems = this.computeMenuItems(S);

    return (
          <div ref={this.canvasRef} onContextMenu={this.onCanvasContext} onMouseDown={this.onCanvasMouseDown}
               style={s('flex:1; position:relative; min-width:0; overflow:hidden; border-radius:26px; background-color:#0F0F0F; background-image:radial-gradient(#2A2A2A 1px, transparent 1px); background-size:22px 22px; background-position:' + (S.pan.x % 22) + 'px ' + (S.pan.y % 22) + 'px;')}>

            <div ref={this.worldRef} style={s(`position:absolute; left:0; top:0; transform:translate(${S.pan.x}px, ${S.pan.y}px);`)}>
              <svg width="10" height="10" style={s('position:absolute; left:0; top:0; overflow:visible; pointer-events:none;')}>
                {edges.map(e => (
                  <g key={e.key}>
                    <path d={e.d} fill="none" stroke={e.color} strokeWidth="1.5" strokeDasharray="5 5" strokeLinecap="round"></path>
                    <path d={e.head} fill="none" stroke={e.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"></path>
                  </g>
                ))}
                {dragPath && <path d={dragPath} fill="none" stroke="#D97757" strokeWidth="1.8" strokeDasharray="5 5" strokeLinecap="round"></path>}
              </svg>

              {S.nodes.map((n, idx) => {
                if (!onScreen(n) && !forceShow(n.id)) return null;
                const open = S.openId === n.id;
                const owned = ownedSet.has(n.id);
                const kidCount = childCount.get(n.id) || 0;
                const bd = BADGE[n.lang] || BADGE.plaintext;
                return (
                  <div key={n.id} style={s(`position:absolute; left:${n.x}px; top:${n.y}px; width:${NW}px; height:${NH}px; z-index:${open ? 60 : 10 + idx};`)}>
                    <div
                      onMouseDown={e => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        this.setState(st => ({ menu: null, nodes: [...st.nodes.filter(m => m.id !== n.id), st.nodes.find(m => m.id === n.id)] }));
                        this.drag = { kind: 'node', id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y };
                      }}
                      onContextMenu={e => {
                        e.preventDefault(); e.stopPropagation();
                        const r = this.canvasRef.current.getBoundingClientRect();
                        this.setState({ menu: { x: e.clientX - r.left, y: e.clientY - r.top, world: this.worldPt(e), target: n.id } });
                      }}
                      onDoubleClick={() => { if (n.kind === 'file') this.openFile(n.id); }}
                      style={s(`width:100%; height:100%; display:flex; align-items:center; gap:12px; padding:0 16px; border-radius:22px; background:${open ? '#201814' : '#171717'}; box-shadow:0 0 0 1.5px ${open ? '#D97757' : (owned ? '#2E2E2E' : '#262626')}, 0 8px 22px rgba(0,0,0,.45); cursor:grab;`)}>

                      <div style={s(`width:32px; height:32px; flex:0 0 32px; border-radius:999px; display:flex; align-items:center; justify-content:center; background:${n.kind === 'folder' ? 'rgba(217,119,87,.14)' : '#212121'};`)}>
                        {n.kind === 'folder'
                          ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#D97757" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a3 3 0 0 1 3-3h2.7a2 2 0 0 1 1.5.7l1 1.3H18a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"></path></svg>
                          : <span style={s(`font-family:'JetBrains Mono', monospace; font-size:10px; font-weight:600; letter-spacing:.02em; color:${n.binary ? '#6E6E6E' : bd.c};`)}>{n.binary ? 'BIN' : bd.l}</span>}
                      </div>

                      <div style={s('flex:1; min-width:0;')}>
                        {S.editingId === n.id ? (
                          <input
                            value={S.editName}
                            autoFocus
                            spellCheck="false"
                            onChange={e => this.setState({ editName: e.target.value })}
                            onBlur={this.commitRename}
                            onKeyDown={e => { if (e.key === 'Enter') this.commitRename(); if (e.key === 'Escape') this.setState({ editingId: null }); }}
                            style={s("width:100%; background:#0D0D0D; border:1.5px solid #D97757; border-radius:999px; color:#EDEDED; font-family:'JetBrains Mono', monospace; font-size:12px; padding:5px 11px;")} />
                        ) : (
                          <React.Fragment>
                            <div style={s("font-family:'JetBrains Mono', monospace; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;")}>{n.name}</div>
                            <div style={s('font-size:10px; color:#6E6E6E; margin-top:3px; letter-spacing:.1em; text-transform:uppercase;')}>
                              {n.kind === 'folder' ? kidCount + ' owned' : (n.binary ? fmtBytes(n.size) : (n.lang || 'text'))}
                            </div>
                          </React.Fragment>
                        )}
                      </div>
                    </div>

                    <div title="input" onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }} onMouseUp={e => this.endLink(e, n.id)} style={s(portS('left', owned))}></div>
                    {n.kind === 'folder' &&
                      <div title="output" onMouseDown={e => this.startLink(e, n.id)} onMouseUp={e => this.endLink(e, n.id)} style={s(portS('right', kidCount > 0))}></div>}
                  </div>
                );
              })}
            </div>

            {!!S.project && S.nodes.length === 0 &&
              <div style={s('position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; pointer-events:none;')}>
                <div style={s("font-family:'JetBrains Mono', monospace; font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:#D97757;")}>empty graph</div>
                <div style={s('font-size:14px; color:#7C7C7C;')}>Right-click the canvas to create a file or a folder</div>
              </div>}

            {!S.project && S.booted &&
              <div style={s('position:absolute; inset:0; background:rgba(11,11,11,.72); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; border-radius:26px;')}>
                <div style={s('width:400px; background:#161616; border-radius:26px; padding:30px;')}>
                  <div style={s("font-family:'JetBrains Mono', monospace; font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:#D97757; margin-bottom:14px;")}>new project</div>
                  <div style={s('font-size:22px; font-weight:600; margin-bottom:8px; letter-spacing:-0.01em;')}>Name your unit</div>
                  <div style={s('font-size:13.5px; color:#8A8A8A; line-height:1.55; margin-bottom:20px;')}>A project holds one graph — folders own folders, folders own files.</div>
                  <input
                    value={S.newProjectName}
                    onChange={e => this.setState({ newProjectName: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') this.createProjectFn(); }}
                    placeholder="orchestrator-api"
                    spellCheck="false"
                    style={s("width:100%; background:#0D0D0D; border:1.5px solid #282828; border-radius:999px; color:#EDEDED; font-family:'JetBrains Mono', monospace; font-size:13px; padding:13px 18px; margin-bottom:12px;")} />
                  <div className="hv-cta" onClick={() => this.createProjectFn()}
                       style={s('background:#D97757; color:#141414; font-weight:600; font-size:14px; text-align:center; padding:13px; border-radius:999px; cursor:pointer;')}>Create project</div>
                </div>
              </div>}

            {S.menu && !S.menu.project &&
              <div onMouseDown={e => e.stopPropagation()} onContextMenu={e => { e.stopPropagation(); e.preventDefault(); }}
                   style={s(`position:absolute; left:${S.menu.x}px; top:${S.menu.y}px; width:212px; background:#191919; border-radius:20px; box-shadow:0 0 0 1px #2A2A2A, 0 18px 40px rgba(0,0,0,.55); z-index:20; overflow:hidden;`)}>
                <div style={s("font-family:'JetBrains Mono', monospace; font-size:9.5px; letter-spacing:.2em; text-transform:uppercase; color:#6E6E6E; padding:12px 18px 8px;")}>
                  {S.menu.target ? 'node' : 'canvas'}
                </div>
                {menuItems.map(m => (
                  <div key={m.label} className="hv-item" onMouseDown={m.action}
                       style={s('display:flex; align-items:center; gap:11px; padding:9px 14px; font-size:13.5px; color:#DCDCDC; cursor:pointer; border-radius:999px; margin:0 7px;')}>
                    <span style={s("font-family:'JetBrains Mono', monospace; font-size:11px; color:#6E6E6E; width:13px;")}>{m.glyph}</span>{m.label}
                  </div>
                ))}
                <div style={s('height:7px;')}></div>
              </div>}
          </div>
    );
  }

  /* ---------- render ---------- */
  render() {
    const S = this.state;
    const tabStyle = k => `padding:8px 17px; font-size:12.5px; border-radius:999px; cursor:pointer; background:${S.tab === k ? '#D97757' : '#1B1B1B'}; color:${S.tab === k ? '#141414' : '#9A9A9A'}; font-weight:${S.tab === k ? 600 : 400};`;
    const paneBase = 'position:absolute; inset:0 10px 10px 10px; background:#161616; border-radius:22px; display:flex; flex-direction:column; overflow:hidden;';
    const inputS = "flex:1; min-width:0; background:#0F0F0F; border:1.5px solid #282828; border-radius:999px; color:#EDEDED; font-family:'JetBrains Mono', monospace; font-size:12px; padding:9px 15px;";
    const pillS = "font-family:'JetBrains Mono', monospace; font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:#6E6E6E; background:#161616; border-radius:999px; padding:5px 11px;";
    const openNode = this.node(S.openId);
    const projectName = S.project ? S.project.name : '';
    const menuItems = this.computeMenuItems(S);
    const statusColor = st => ({ succeeded: '#D97757', failed: '#C25B4A', cancelled: '#6E6E6E', running: '#EFC7B2', queued: '#3A3A3A' }[st] || '#3A3A3A');

    return (
      <div style={s('height:100vh; display:flex; flex-direction:column; background:#0B0B0B; color:#EDEDED; font-family:Figtree, system-ui, sans-serif; overflow:hidden; user-select:none;')}>

        <div style={s('height:56px; flex:0 0 56px; display:flex; align-items:center; gap:16px; padding:0 18px; background:#111111;')}>
          <div style={s('display:flex; align-items:center; gap:10px;')}>
            <div style={s('width:26px; height:26px; border-radius:999px; background:#D97757; display:flex; align-items:center; justify-content:center;')}>
              <div style={s('width:9px; height:9px; border-radius:999px; background:#111111;')}></div>
            </div>
            <span style={s("font-family:'JetBrains Mono', monospace; font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:#B4B4B4;")}>cloud coding unit</span>
          </div>
          <div style={s('width:1px; height:18px; background:#282828; border-radius:999px;')}></div>
          <div style={s('display:flex; align-items:center; gap:8px; min-width:0;')}>
            <span style={s('font-size:13px; color:#7C7C7C;')}>project</span>
            <span style={s('font-size:13.5px; font-weight:600;')}>{projectName || 'none'}</span>
          </div>
          <div style={s('flex:1;')}></div>
          <div style={s("display:flex; align-items:center; gap:8px; font-family:'JetBrains Mono', monospace; font-size:10.5px; color:#8A8A8A;")}>
            <span style={s('display:inline-flex; align-items:center; gap:7px; background:#1A1A1A; border-radius:999px; padding:6px 13px;')}>
              <span style={s('width:6px; height:6px; border-radius:999px; background:#D97757;')}></span>{S.nodes.length} nodes
            </span>
            <span style={s('display:inline-flex; align-items:center; gap:7px; background:#1A1A1A; border-radius:999px; padding:6px 13px;')}>{S.edges.length} links</span>
            <span style={s('display:inline-flex; align-items:center; gap:7px; background:#1A1A1A; border-radius:999px; padding:6px 13px;')}>
              <span style={s(`width:6px; height:6px; border-radius:999px; background:${S.runtime === 'ready' ? '#D97757' : '#3A3A3A'};`)}></span>runtime {S.runtime}
            </span>
            {S.user && <span className="hv-text" title="sign out" onClick={() => this.signOut()}
                  style={s('display:inline-flex; align-items:center; gap:7px; background:#1A1A1A; border-radius:999px; padding:6px 13px; cursor:pointer;')}>{S.user.email} · sign out</span>}
          </div>
        </div>

        <div style={s('flex:1; display:flex; min-height:0; padding:10px; gap:10px;')}>

          <div style={s('width:60px; flex:0 0 60px; background:#111111; border-radius:24px; display:flex; flex-direction:column; align-items:center; padding:12px 0; gap:9px; overflow:auto;')}>
            {S.projectList.map(p => (
              <div key={p.id} title={p.name} onClick={() => this.openProject(p)}
                   onContextMenu={e => { e.preventDefault(); e.stopPropagation(); this.setState({ menu: { x: e.clientX - 10, y: e.clientY - 66, project: p } }); }}
                   style={s(`width:38px; height:38px; flex:0 0 38px; border-radius:999px; display:flex; align-items:center; justify-content:center; font-family:'JetBrains Mono', monospace; font-size:11px; cursor:pointer; background:${S.project && p.id === S.project.id ? '#D97757' : '#1B1B1B'}; color:${S.project && p.id === S.project.id ? '#141414' : '#9A9A9A'};`)}>
                {p.name.slice(0, 2).toLowerCase()}
              </div>
            ))}
            <div className="hv-add" title="New project" onClick={() => { this.flushContent(); this.disconnectTerminal(); this.currentProjectId = null; this.setState({ project: null, newProjectName: '', nodes: [], edges: [], openId: null, runtime: 'offline' }); history.replaceState(null, '', '/'); }}
                 style={s('width:38px; height:38px; flex:0 0 38px; border-radius:999px; background:#1B1B1B; color:#8A8A8A; display:flex; align-items:center; justify-content:center; font-size:19px; cursor:pointer; transition:all .18s cubic-bezier(.22,1,.36,1);')}>+</div>
          </div>

          {this.memoCanvas(S)}

          {S.menu && S.menu.project &&
            <div onMouseDown={e => e.stopPropagation()} onContextMenu={e => { e.stopPropagation(); e.preventDefault(); }}
                 style={s(`position:fixed; left:${S.menu.x + 10}px; top:${S.menu.y + 66}px; width:212px; background:#191919; border-radius:20px; box-shadow:0 0 0 1px #2A2A2A, 0 18px 40px rgba(0,0,0,.55); z-index:80; overflow:hidden;`)}>
              <div style={s("font-family:'JetBrains Mono', monospace; font-size:9.5px; letter-spacing:.2em; text-transform:uppercase; color:#6E6E6E; padding:12px 18px 8px;")}>{S.menu.project.name}</div>
              {menuItems.map(m => (
                <div key={m.label} className="hv-item" onMouseDown={m.action}
                     style={s('display:flex; align-items:center; gap:11px; padding:9px 14px; font-size:13.5px; color:#DCDCDC; cursor:pointer; border-radius:999px; margin:0 7px;')}>
                  <span style={s("font-family:'JetBrains Mono', monospace; font-size:11px; color:#6E6E6E; width:13px;")}>{m.glyph}</span>{m.label}
                </div>
              ))}
              <div style={s('height:7px;')}></div>
            </div>}

          <div style={s('width:560px; flex:0 0 560px; display:flex; flex-direction:column; min-width:0; gap:10px;')}>

            <div style={s('flex:1; min-height:0; background:#111111; border-radius:26px; display:flex; flex-direction:column; overflow:hidden;')}>
              <div style={s('height:52px; flex:0 0 52px; display:flex; align-items:center; gap:6px; padding:0 12px;')}>
                {[['Editor', 'editor'], ['MCP', 'mcp'], ['Tree', 'tree'], ['Builds', 'builds']].map(([label, k]) => (
                  <div key={k} onClick={() => { this.setState({ tab: k }); if (k === 'builds' && !this.bws) this.connectBuilds(); }} style={s(tabStyle(k))}>{label}</div>
                ))}
                <div style={s('flex:1;')}></div>
                {openNode && S.tab === 'editor' && this.dirtyContent.size > 0 &&
                  <span style={s("font-family:'JetBrains Mono', monospace; font-size:9.5px; letter-spacing:.14em; text-transform:uppercase; color:#6E6E6E; padding-right:6px;")}>saving…</span>}
                <input type="file" multiple ref={this.fileInputRef} onChange={this.onUpload} style={s('display:none;')} />
              </div>

              <div style={s('flex:1; min-height:0; position:relative; padding:0 10px 10px;')}>

                <div style={s(paneBase + (S.tab === 'editor' ? '' : 'visibility:hidden; pointer-events:none;'))}>
                  <div style={s('height:42px; flex:0 0 42px; display:flex; align-items:center; gap:10px; padding:0 18px;')}>
                    <span style={s("font-family:'JetBrains Mono', monospace; font-size:11.5px; color:" + (openNode ? '#EDEDED' : '#6E6E6E') + ';')}>
                      {openNode ? openNode.name : 'no file'}
                    </span>
                    <div style={s('flex:1;')}></div>
                    <span style={s("font-family:'JetBrains Mono', monospace; font-size:9.5px; color:#6E6E6E; text-transform:uppercase; letter-spacing:.14em; background:#1E1E1E; border-radius:999px; padding:4px 11px;")}>
                      {openNode ? (openNode.lang || 'text') : '—'}
                    </span>
                  </div>
                  <div ref={this.editorRef} onKeyDown={e => e.stopPropagation()}
                       style={s('flex:1; min-height:0; border-radius:0 0 22px 22px; overflow:hidden; user-select:text;')}></div>
                  {!openNode &&
                    <div style={s('position:absolute; inset:42px 0 0 0; background:#161616; border-radius:0 0 22px 22px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:9px;')}>
                      <div style={s("font-family:'JetBrains Mono', monospace; font-size:10.5px; letter-spacing:.2em; text-transform:uppercase; color:#6E6E6E;")}>no file open</div>
                      <div style={s('font-size:13.5px; color:#7C7C7C;')}>Double-click a file node on the canvas</div>
                    </div>}
                </div>

                <div style={s(paneBase + (S.tab === 'mcp' ? '' : 'display:none;'))}>
                  <div style={s('padding:20px 20px 14px;')}>
                    <div style={s("font-family:'JetBrains Mono', monospace; font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:#D97757;")}>mcp · claude code</div>
                    <div style={s('font-size:13.5px; color:#8A8A8A; margin-top:9px; line-height:1.55;')}>Tools Claude Code on your laptop gets through the Quist MCP server. It codes here, never on your disk. Toggles apply on the next call.</div>
                  </div>
                  <div style={s('flex:1; overflow:auto; padding:0 20px 20px; display:flex; flex-direction:column; gap:10px;')}>

                    <div style={s('background:#1B1B1B; border-radius:22px; padding:16px 18px;')}>
                      <div style={s('display:flex; align-items:center; gap:12px;')}>
                        <div style={s('width:9px; height:9px; border-radius:999px; flex:0 0 9px; background:#D97757;')}></div>
                        <div style={s('flex:1; min-width:0;')}>
                          <div style={s("font-family:'JetBrains Mono', monospace; font-size:12.5px;")}>version</div>
                          <div style={s('font-size:11.5px; color:#7C7C7C; margin-top:4px;')}>Snapshot the graph, revert every file to it</div>
                        </div>
                        <div style={s(pillS)}>2 tools</div>
                      </div>
                      <div style={s('display:flex; gap:8px; margin-top:14px;')}>
                        <input
                          value={S.versionLabel}
                          onChange={e => this.setState({ versionLabel: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') this.saveVersionFn(); }}
                          placeholder="v0.1.0" spellCheck="false"
                          style={s(inputS)} />
                        <div className="hv-cta" onClick={() => this.saveVersionFn()}
                             style={s('background:#D97757; color:#141414; font-weight:600; font-size:12.5px; padding:9px 18px; border-radius:999px; cursor:pointer; white-space:nowrap;')}>Set version</div>
                      </div>
                      <div style={s('display:flex; flex-direction:column; gap:7px; margin-top:12px;')}>
                        {S.versions.map(v => (
                          <div key={v.id} style={s('display:flex; align-items:center; gap:12px; background:#151515; border-radius:999px; padding:8px 8px 8px 16px;')}>
                            <span style={s("font-family:'JetBrains Mono', monospace; font-size:11.5px; color:#D97757;")}>{v.label}</span>
                            <span style={s("font-family:'JetBrains Mono', monospace; font-size:10.5px; color:#6E6E6E;")}>{v.files} files · {fmtTime(v.created_at)}</span>
                            <div style={s('flex:1;')}></div>
                            <div className="hv-text" onClick={() => this.revertVersion(v)}
                                 style={s('font-size:11.5px; color:#9A9A9A; background:#1F1F1F; border-radius:999px; padding:6px 14px; cursor:pointer;')}>Revert</div>
                          </div>
                        ))}
                        {!S.versions.length &&
                          <div style={s("font-family:'JetBrains Mono', monospace; font-size:11px; color:#5A5A5A; padding:4px 2px;")}>no snapshots yet</div>}
                      </div>
                    </div>

                    {S.mcp.map(m => (
                      <div key={m.name} style={s('background:#1B1B1B; border-radius:22px; padding:15px 18px; display:flex; align-items:center; gap:14px;')}>
                        <div style={s(`width:9px; height:9px; border-radius:999px; flex:0 0 9px; background:${m.on ? '#D97757' : '#3A3A3A'};`)}></div>
                        <div style={s('flex:1; min-width:0;')}>
                          <div style={s("font-family:'JetBrains Mono', monospace; font-size:12.5px;")}>{m.name}</div>
                          <div style={s('font-size:11.5px; color:#7C7C7C; margin-top:4px;')}>{m.desc}</div>
                        </div>
                        <div style={s(pillS)}>{m.kind}</div>
                        <div onClick={() => S.project && this.toggleTool(m.name)}
                             style={s(`width:42px; height:24px; border-radius:999px; background:${m.on ? '#D97757' : '#2A2A2A'}; padding:3px; display:flex; cursor:pointer; transition:background .18s cubic-bezier(.22,1,.36,1);`)}>
                          <div style={s(`width:18px; height:18px; border-radius:999px; background:${m.on ? '#141414' : '#8A8A8A'}; margin-left:${m.on ? '18px' : '0'}; transition:margin .18s cubic-bezier(.22,1,.36,1);`)}></div>
                        </div>
                      </div>
                    ))}

                    {S.connect ? (
                      <div style={s('background:#1B1B1B; border-radius:22px; padding:16px 18px; user-select:text;')}>
                        <div style={s('display:flex; align-items:center; gap:12px;')}>
                          <div style={s('width:9px; height:9px; border-radius:999px; flex:0 0 9px; background:#D97757;')}></div>
                          <div style={s('flex:1; min-width:0;')}>
                            <div style={s("font-family:'JetBrains Mono', monospace; font-size:12.5px;")}>connect claude code</div>
                            <div style={s('font-size:11.5px; color:#7C7C7C; margin-top:4px;')}>Token {S.connect.prefix}… is shown once. Three steps, on the laptop that runs Claude Code.</div>
                          </div>
                          <div className="hv-text" onClick={() => { navigator.clipboard.writeText(this.connectConfig()); this.log('config copied', 'ok'); }}
                               style={s('font-size:11.5px; color:#9A9A9A; background:#1F1F1F; border-radius:999px; padding:6px 14px; cursor:pointer;')}>Copy config</div>
                        </div>
                        <div style={s('font-size:12.5px; color:#B4B4B4; line-height:1.7; margin-top:12px;')}>
                          1 · Save <a href="/quist-mcp.js" download>quist-mcp.js</a> anywhere on the laptop (needs Node ≥ 18).<br />
                          2 · Put this in <span style={s("font-family:'JetBrains Mono', monospace; color:#EDEDED;")}>.mcp.json</span> in an empty folder, fix the path to the file, and start <span style={s("font-family:'JetBrains Mono', monospace; color:#EDEDED;")}>claude</span> there.<br />
                          3 · Deny its local tools so it only codes through Quist — the README has the settings block.
                        </div>
                        <pre style={s("font-family:'JetBrains Mono', monospace; font-size:11px; line-height:1.6; color:#B4B4B4; background:#0F0F0F; border-radius:16px; padding:14px 16px; margin:12px 0 0; overflow:auto; white-space:pre;")}>{this.connectConfig()}</pre>
                      </div>
                    ) : (
                      <div className="hv-dash" onClick={() => S.project && this.connectClaude()}
                           style={s('border:1.5px dashed #2C2C2C; border-radius:22px; padding:14px; text-align:center; font-size:12.5px; color:#7C7C7C; cursor:pointer;')}>Connect Claude Code</div>
                    )}
                  </div>
                </div>

                <div style={s(paneBase + (S.tab === 'tree' ? '' : 'display:none;'))}>
                  <div style={s('padding:20px; overflow:auto;')}>
                    <div style={s("font-family:'JetBrains Mono', monospace; font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:#D97757; margin-bottom:16px;")}>resolved tree</div>
                    <pre style={s("font-family:'JetBrains Mono', monospace; font-size:12.5px; line-height:1.8; color:#B4B4B4; margin:0; white-space:pre;")}>{S.tab === 'tree' ? this.treeText() : ''}</pre>
                  </div>
                </div>

                <div style={s(paneBase + (S.tab === 'builds' ? '' : 'display:none;'))}>
                  <div style={s('padding:20px 20px 14px;')}>
                    <div style={s("font-family:'JetBrains Mono', monospace; font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:#D97757;")}>builds · downloads</div>
                    <div style={s('font-size:13.5px; color:#8A8A8A; margin-top:9px; line-height:1.55;')}>Compiled on the server as a queued job. Finished binaries are kept here for any machine you sign in from.</div>
                  </div>
                  <div style={s('flex:1; overflow:auto; padding:0 20px 20px; display:flex; flex-direction:column; gap:10px;')}>
                    <div style={s('background:#1B1B1B; border-radius:22px; padding:16px 18px;')}>
                      <div style={s('display:flex; gap:8px;')}>
                        <select value={S.buildTc} onChange={e => this.pickToolchain(e.target.value)}
                                style={s("flex:1; min-width:0; background:#0F0F0F; border:1.5px solid #282828; border-radius:999px; color:#EDEDED; font-family:'JetBrains Mono', monospace; font-size:12px; padding:9px 15px; cursor:pointer;")}>
                          {S.toolchains.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                        <input value={S.buildLabel} onChange={e => this.setState({ buildLabel: e.target.value })} placeholder="label · v0.1.0" spellCheck="false" style={s(inputS + 'flex:0 0 150px;')} />
                      </div>
                      <div style={s('display:flex; gap:8px; margin-top:8px;')}>
                        <input value={S.buildCmd} onChange={e => this.setState({ buildCmd: e.target.value })} placeholder="command" spellCheck="false" style={s(inputS)} />
                      </div>
                      <div style={s('display:flex; gap:8px; margin-top:8px;')}>
                        <input value={S.buildGlob} onChange={e => this.setState({ buildGlob: e.target.value })} placeholder="artifacts · out/app, out/*.exe" spellCheck="false" style={s(inputS)} />
                        <div className="hv-cta" onClick={() => !S.building && S.project && this.startBuild()}
                             style={s('background:#D97757; color:#141414; font-weight:600; font-size:12.5px; padding:9px 18px; border-radius:999px; cursor:pointer; white-space:nowrap;')}>Build</div>
                      </div>
                    </div>

                    {S.builds.map(b => (
                      <div key={b.id} style={s('background:#1B1B1B; border-radius:22px; padding:12px 18px;')}>
                        <div onClick={() => this.openBuildLog(b.id)} style={s('display:flex; align-items:center; gap:12px; cursor:pointer;')}>
                          <div style={s(`width:9px; height:9px; border-radius:999px; flex:0 0 9px; background:${statusColor(b.status)};`)}></div>
                          <div style={s('flex:1; min-width:0;')}>
                            <div style={s("font-family:'JetBrains Mono', monospace; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;")}>{b.toolchain}{b.label ? ' · ' + b.label : ''}</div>
                            <div style={s('font-size:11.5px; color:#7C7C7C; margin-top:4px;')}>{b.status}{b.exit_code != null ? ' · exit ' + b.exit_code : ''} · {fmtTime(b.created_at)} · {b.id.slice(0, 8)}</div>
                          </div>
                          {(b.status === 'queued' || b.status === 'running') &&
                            <div className="hv-text" onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); api('POST', '/api/builds/' + b.id + '/cancel').catch(() => {}); }}
                                 style={s('font-size:11.5px; color:#9A9A9A; background:#1F1F1F; border-radius:999px; padding:6px 14px; cursor:pointer;')}>Cancel</div>}
                          <div style={s(pillS)}>{S.openBuild === b.id ? 'hide log' : 'log'}</div>
                        </div>
                        {!!(b.artifacts && b.artifacts.length) &&
                          <div style={s('display:flex; flex-wrap:wrap; gap:7px; margin-top:10px;')}>
                            {b.artifacts.map(a => (
                              <a key={a.id} href={'/api/artifacts/' + a.id + '/download'} className="hv-text"
                                 style={s("font-family:'JetBrains Mono', monospace; font-size:11px; color:#D97757; background:#151515; border-radius:999px; padding:6px 13px;")}>↓ {a.name} · {fmtBytes(a.size)}</a>
                            ))}
                          </div>}
                        {S.openBuild === b.id &&
                          <pre style={s("font-family:'JetBrains Mono', monospace; font-size:11px; line-height:1.6; color:#B4B4B4; background:#0F0F0F; border-radius:16px; padding:14px 16px; margin:10px 0 0; max-height:260px; overflow:auto; white-space:pre-wrap; user-select:text;")}>{S.buildLogs[b.id] || '(no output yet)'}</pre>}
                      </div>
                    ))}
                    {!S.builds.length &&
                      <div style={s("font-family:'JetBrains Mono', monospace; font-size:11px; color:#5A5A5A; padding:4px 2px;")}>no builds yet</div>}
                  </div>
                </div>
              </div>
            </div>

            <div onClick={() => this.term && this.term.focus()}
                 style={s('height:238px; flex:0 0 238px; background:#0D0D0D; border-radius:26px; display:flex; flex-direction:column; overflow:hidden;')}>
              <div style={s('height:44px; flex:0 0 44px; display:flex; align-items:center; gap:9px; padding:0 18px;')}>
                <span style={s(`width:7px; height:7px; border-radius:999px; background:${S.runtime === 'ready' ? '#D97757' : '#3A3A3A'};`)}></span>
                <span style={s("font-family:'JetBrains Mono', monospace; font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:#8A8A8A;")}>terminal — {projectName || 'none'}</span>
                <div style={s('flex:1;')}></div>
                <span className="hv-text" onClick={e => { e.stopPropagation(); this.send({ t: 'clear' }); this.term && this.term.reset(); this.send({ t: 'in', d: '\x0c' }); }}
                      style={s("font-family:'JetBrains Mono', monospace; font-size:10px; color:#6E6E6E; cursor:pointer; background:#191919; border-radius:999px; padding:5px 13px;")}>clear</span>
              </div>
              <div ref={this.termRef} style={s('flex:1; min-height:0; user-select:text;')}></div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(<Unit />);
