let token = localStorage.getItem('admin_token') || null;
let uploadType = 'internal';
let selectedFile = null;

// ========== AUTH ==========
async function login() {
  const u = document.getElementById('loginUser').value;
  const p = document.getElementById('loginPass').value;
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({username:u, password:p})
    });
    const d = await r.json();
    if (r.ok) {
      token = d.token;
      localStorage.setItem('admin_token', token);
      showMain();
    } else {
      document.getElementById('loginErr').textContent = d.error || 'Failed';
    }
  } catch(e) { document.getElementById('loginErr').textContent = 'Connection failed'; }
}

function logout() {
  token = null; localStorage.removeItem('admin_token');
  document.getElementById('loginView').style.display = '';
  document.getElementById('mainView').style.display = 'none';
}

function showMain() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('mainView').style.display = '';
  loadDashboard();
}

function api(url, opts={}) {
  opts.headers = opts.headers || {};
  opts.headers['x-admin-token'] = token;
  return fetch(url, opts).then(r => {
    if (r.status === 401) { logout(); throw new Error('Session expired'); }
    return r;
  });
}

// ========== TABS ==========
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  event.target.classList.add('active');
  if (name === 'dashboard') loadDashboard();
  if (name === 'builds') loadBuilds();
}

// ========== DASHBOARD ==========
async function loadDashboard() {
  try {
    const r = await api('/api/admin/stats');
    const d = await r.json();
    document.getElementById('statTotal').textContent = d.totalDownloads;
    document.getElementById('statToday').textContent = d.todayDownloads;
    const int = d.byType.find(x=>x.type==='internal');
    const ext = d.byType.find(x=>x.type==='external');
    document.getElementById('statInternal').textContent = int ? int.count : 0;
    document.getElementById('statExternal').textContent = ext ? ext.count : 0;
  } catch(e) {}

  try {
    const ri = await api('/api/version/internal'); const di = await ri.json();
    document.getElementById('curInternalVer').textContent = ri.ok ? 'v'+di.version : di.version ? 'v'+di.version : 'No build';
  } catch(e) { document.getElementById('curInternalVer').textContent = 'No build set'; }
  try {
    const re = await api('/api/version/external'); const de = await re.json();
    document.getElementById('curExternalVer').textContent = re.ok ? 'v'+de.version : de.version ? 'v'+de.version : 'No build';
  } catch(e) { document.getElementById('curExternalVer').textContent = 'No build set'; }
}

// ========== UPLOAD ==========
function setType(t, el) {
  uploadType = t;
  document.querySelectorAll('.pill-group .pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
}

function fileSelected(input) {
  if (input.files.length) {
    selectedFile = input.files[0];
    document.getElementById('dropText').textContent = selectedFile.name + ' (' + (selectedFile.size/1024).toFixed(0) + ' KB)';
    document.getElementById('dropZone').classList.add('has-file');
  }
}

// Drag and drop
const dz = document.getElementById('dropZone');
if (dz) {
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor = 'var(--red)'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; });
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.style.borderColor = '';
    if (e.dataTransfer.files.length) {
      selectedFile = e.dataTransfer.files[0];
      document.getElementById('dropText').textContent = selectedFile.name + ' (' + (selectedFile.size/1024).toFixed(0) + ' KB)';
      dz.classList.add('has-file');
    }
  });
}

async function uploadBuild() {
  const version = document.getElementById('uploadVersion').value.trim();
  const changelog = document.getElementById('uploadChangelog').value.trim();
  const setLatest = document.getElementById('uploadLatest').checked;
  const status = document.getElementById('uploadStatus');

  if (!version) { status.textContent = 'Version required'; status.className = 'status err'; return; }
  if (!selectedFile) { status.textContent = 'No file selected'; status.className = 'status err'; return; }

  const fd = new FormData();
  fd.append('file', selectedFile);
  fd.append('type', uploadType);
  fd.append('version', version);
  fd.append('changelog', changelog);
  fd.append('setLatest', setLatest ? 'true' : 'false');

  status.textContent = 'Uploading...'; status.className = 'status';
  document.getElementById('uploadProgress').style.display = '';

  try {
    const r = await fetch('/api/admin/upload', {
      method: 'POST', headers: {'x-admin-token': token}, body: fd
    });
    const d = await r.json();
    if (r.ok) {
      status.textContent = 'Uploaded! Build ID: ' + d.id; status.className = 'status ok';
      document.getElementById('progressBar').style.width = '100%';
      selectedFile = null;
      document.getElementById('dropText').textContent = 'Drop .dll or .exe here, or click to browse';
      document.getElementById('dropZone').classList.remove('has-file');
      document.getElementById('uploadVersion').value = '';
      document.getElementById('uploadChangelog').value = '';
    } else {
      status.textContent = d.error || 'Upload failed'; status.className = 'status err';
    }
  } catch(e) { status.textContent = 'Upload failed: ' + e.message; status.className = 'status err'; }

  setTimeout(() => { document.getElementById('uploadProgress').style.display = 'none'; document.getElementById('progressBar').style.width = '0'; }, 2000);
}

// ========== BUILDS ==========
async function loadBuilds() {
  const list = document.getElementById('buildsList');
  list.innerHTML = '<div style="color:var(--dim)">Loading...</div>';
  try {
    const r = await api('/api/admin/builds');
    const builds = await r.json();
    if (!builds.length) { list.innerHTML = '<div style="color:var(--dim)">No builds uploaded yet</div>'; return; }

    list.innerHTML = builds.map(b => `
      <div class="build-row ${b.is_latest ? 'latest' : ''}">
        <span class="type-badge ${b.type}">${b.type.toUpperCase()}</span>
        <div class="build-info">
          <div class="bi-top">
            <span class="bi-ver">v${b.version}</span>
            ${b.is_latest ? '<span class="latest-badge">LATEST</span>' : ''}
          </div>
          <div class="bi-file">${b.filename} (${(b.filesize/1024).toFixed(0)} KB)</div>
          ${b.changelog ? '<div class="bi-cl">' + b.changelog + '</div>' : ''}
          <div class="bi-date">${new Date(b.uploaded_at).toLocaleString()}</div>
        </div>
        <div class="build-actions">
          ${!b.is_latest ? `<button class="btn-latest" onclick="setLatest(${b.id})">Set Latest</button>` : ''}
          <button class="btn-delete" onclick="deleteBuild(${b.id})">Delete</button>
        </div>
      </div>
    `).join('');
  } catch(e) { list.innerHTML = '<div class="err">Failed to load builds</div>'; }
}

async function setLatest(id) {
  await api('/api/admin/set-latest/'+id, {method:'POST'});
  loadBuilds(); loadDashboard();
}

async function deleteBuild(id) {
  if (!confirm('Delete this build?')) return;
  await api('/api/admin/builds/'+id, {method:'DELETE'});
  loadBuilds();
}

// ========== SETTINGS ==========
async function changePass() {
  const p = document.getElementById('newPass').value;
  const s = document.getElementById('passStatus');
  if (p.length < 6) { s.textContent = 'Min 6 characters'; s.className = 'status err'; return; }
  const r = await api('/api/admin/change-password', {
    method:'POST', headers:{'Content-Type':'application/json','x-admin-token':token},
    body:JSON.stringify({newPassword:p})
  });
  if (r.ok) { s.textContent = 'Password updated'; s.className = 'status ok'; document.getElementById('newPass').value = ''; }
  else { s.textContent = 'Failed'; s.className = 'status err'; }
}

// ========== INIT ==========
// Enter key on login
document.getElementById('loginPass').addEventListener('keydown', e => { if(e.key==='Enter') login(); });

if (token) {
  api('/api/admin/stats').then(r => {
    if (r.ok) showMain();
    else logout();
  }).catch(() => logout());
}
