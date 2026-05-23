import { NextResponse } from 'next/server';

const ADMIN_KEY = 'schnapp_fish_token';

export async function GET() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FISH SYNC</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: #f0f6fc;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'IBM Plex Mono', monospace;
      position: relative;
    }
    .container {
      width: 100%;
      max-width: 360px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .headline {
      font-family: 'Bebas Neue', sans-serif;
      font-size: clamp(52px, 14vw, 88px);
      color: #0a2a40;
      line-height: 0.88;
      letter-spacing: 0.04em;
      user-select: none;
    }
    .subtext {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      color: #6a8aaa;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      margin-top: 14px;
      margin-bottom: 32px;
    }
    .btn {
      position: relative;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: #0a2a40;
      color: #e8f4fc;
      font-family: 'Bebas Neue', sans-serif;
      font-size: 22px;
      letter-spacing: 0.12em;
      padding: 16px 32px;
      border: none;
      cursor: pointer;
      overflow: hidden;
      transition: background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
      outline: none;
    }
    .btn:not(:disabled):hover {
      background: #072030;
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(10, 42, 64, 0.28);
    }
    .btn::after {
      content: '';
      position: absolute;
      top: 0; left: -100%;
      width: 60%; height: 100%;
      background: linear-gradient(105deg, transparent 30%, rgba(232,244,252,0.12) 50%, transparent 70%);
      pointer-events: none;
    }
    .btn:not(:disabled):hover::after { animation: shimmer 0.55s ease forwards; }
    @keyframes shimmer { 0% { left: -80%; } 100% { left: 140%; } }
    .btn-icon { width: 18px; height: 18px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .btn-icon svg { width: 18px; height: 18px; fill: none; stroke: #e8f4fc; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .btn.state-running { opacity: 0.8; cursor: not-allowed; pointer-events: none; }
    .btn.state-success { background: #0a4a28; }
    .btn.state-success:hover { background: #083820; }
    .btn.state-error { background: #4a1010; }
    .spinning svg { animation: spin 0.8s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .status { margin-top: 12px; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: #8aaabb; min-height: 14px; transition: color 0.2s ease; }
    .status.ok { color: #3a9a68; }
    .status.running { color: #2a7ab8; }
    .status.error { color: #aa4a40; }
    .sign-out { margin-top: 32px; background: none; border: none; font-family: 'IBM Plex Mono', monospace; font-size: 8px; color: #b0c4d4; letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; }
    .watermark { position: fixed; bottom: 14px; right: 16px; font-size: 8px; color: #c0d0e0; letter-spacing: 0.08em; font-family: 'IBM Plex Mono', monospace; user-select: none; }
    /* Login */
    .login-input { width: 100%; background: white; border: 1px solid #c8d8e8; padding: 14px 16px; font-family: 'IBM Plex Mono', monospace; font-size: 14px; color: #0a2a40; outline: none; margin-bottom: 8px; }
    .pin-error { font-size: 9px; color: #aa4a40; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="container" id="app"></div>
  <div class="watermark">schnapp.bet/fish</div>

  <script>
    const ADMIN_KEY = '${ADMIN_KEY}';
    let savedPin = localStorage.getItem(ADMIN_KEY) || '';
    let running = false;

    function render() {
      const app = document.getElementById('app');
      if (!savedPin) { renderLogin(app); } else { renderMain(app); }
    }

    function renderLogin(app) {
      app.innerHTML = \`
        <div class="headline">FISH<br>STALE.</div>
        <div class="subtext">Data old. People mad. Fix now.</div>
        <input id="pin-input" class="login-input" type="password" placeholder="Passcode" />
        <div class="pin-error" id="pin-error" style="display:none">Wrong passcode.</div>
        <button class="btn" onclick="handleLogin()">ENTER</button>
      \`;
      const inp = document.getElementById('pin-input');
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
      inp.focus();
    }

    function renderMain(app) {
      app.innerHTML = \`
        <div class="headline">FISH<br>STALE.</div>
        <div class="subtext">Data old. People mad. Fix now.</div>
        <button class="btn" id="btn" onclick="runSync()">
          <span class="btn-icon" id="btn-icon">
            <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </span>
          <span id="btn-label">REFRESH</span>
        </button>
        <div class="status ok" id="status">Last refresh: today at 11:00 AM</div>
        <button class="sign-out" onclick="signOut()">sign out</button>
      \`;
    }

    async function handleLogin() {
      const pin = document.getElementById('pin-input').value;
      const errEl = document.getElementById('pin-error');
      errEl.style.display = 'none';
      const res = await fetch('/api/admin/codes', { headers: { 'x-admin-token': pin } });
      if (res.ok) {
        localStorage.setItem(ADMIN_KEY, pin);
        savedPin = pin;
        render();
      } else {
        errEl.style.display = 'block';
      }
    }

    function signOut() {
      localStorage.removeItem(ADMIN_KEY);
      savedPin = '';
      render();
    }

    async function runSync() {
      if (running) return;
      running = true;
      const btn = document.getElementById('btn');
      const icon = document.getElementById('btn-icon');
      const label = document.getElementById('btn-label');
      const status = document.getElementById('status');

      btn.className = 'btn state-running';
      icon.className = 'btn-icon spinning';
      label.textContent = 'FETCHING...';
      status.className = 'status running';
      status.textContent = 'Contacting AppFolio...';

      try {
        const res = await fetch('/api/fish-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': savedPin },
          body: JSON.stringify({}),
        });
        if (res.status === 401) { signOut(); return; }
        const data = await res.json();
        if (!res.ok) {
          btn.className = 'btn state-error';
          icon.className = 'btn-icon';
          label.textContent = 'REFRESH';
          status.className = 'status error';
          status.textContent = data.error ?? 'Dispatch failed.';
          running = false;
          return;
        }
        btn.className = 'btn state-success';
        icon.className = 'btn-icon';
        label.textContent = 'FISH FRESH NOW';
        status.className = 'status ok';
        status.textContent = 'Last refresh: just now';
        setTimeout(() => {
          btn.className = 'btn';
          label.textContent = 'REFRESH';
          running = false;
        }, 3500);
      } catch (e) {
        btn.className = 'btn state-error';
        icon.className = 'btn-icon';
        label.textContent = 'REFRESH';
        status.className = 'status error';
        status.textContent = e.message ?? 'Unknown error.';
        running = false;
      }
    }

    render();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
