// Shared by login.html and signup.html.
(function () {
  const form = document.querySelector('form');
  const err = document.querySelector('.err');
  const btn = form.querySelector('button');
  const mode = form.dataset.mode;
  fetch('/api/me', { credentials: 'same-origin' }).then(r => { if (r.ok) location.replace('/'); }).catch(() => {});
  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    const body = { email: form.email.value.trim(), password: form.password.value };
    try {
      const r = await fetch('/api/auth/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'request failed');
      const next = new URLSearchParams(location.search).get('next');
      location.replace(next && next.startsWith('/') ? next : '/');
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
})();
