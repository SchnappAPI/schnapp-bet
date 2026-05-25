import { NextResponse } from 'next/server';

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
      color: #003057;
      line-height: 0.88;
      letter-spacing: 0.04em;
      user-select: none;
    }
    .subtext {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      color: #306e7b;
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
      background: #004b87;
      color: #f8fafb;
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
      background: #003057;
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(0, 48, 87, 0.32);
    }
    .btn::after {
      content: '';
      position: absolute;
      top: 0; left: -100%;
      width: 60%; height: 100%;
      background: linear-gradient(105deg, transparent 30%, rgba(184,217,235,0.10) 50%, transparent 70%);
      pointer-events: none;
    }
    .btn:not(:disabled):hover::after { animation: shimmer 0.55s ease forwards; }
    @keyframes shimmer { 0% { left: -80%; } 100% { left: 140%; } }
    .btn-icon { width: 18px; height: 18px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .btn-icon svg { width: 18px; height: 18px; fill: none; stroke: #b8d9eb; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .btn.state-running { opacity: 0.75; cursor: not-allowed; pointer-events: none; }
    .btn.state-success { background: #306e7b; }
    .btn.state-success:hover { background: #245660; }
    .btn.state-error { background: #774b52; }
    .spinning svg { animation: spin 0.8s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .status { margin-top: 12px; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: #306e7b; min-height: 14px; transition: color 0.2s ease; }
    .status.ok { color: #4e7e70; }
    .status.running { color: #2587c8; }
    .status.error { color: #774b52; }

    /* Log panel */
    .log-wrap {
      width: 100%;
      margin-top: 28px;
      display: none;
      flex-direction: column;
      align-items: stretch;
      text-align: left;
    }
    .log-wrap.visible { display: flex; }
    .log-header {
      font-size: 8px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #306e7b;
      margin-bottom: 8px;
    }
    .log-box {
      background: #003057;
      padding: 14px 16px;
      min-height: 48px;
      max-height: 280px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .log-line {
      display: flex;
      gap: 10px;
      align-items: baseline;
      opacity: 0;
      animation: fadein 0.2s ease forwards;
    }
    @keyframes fadein { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
    .log-time {
      font-size: 9px;
      color: #2587c8;
      flex-shrink: 0;
      letter-spacing: 0.04em;
    }
    .log-text {
      font-size: 10px;
      color: #b8d9eb;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 500;
    }
    .log-text.ok   { color: #4e7e70; }
    .log-text.err  { color: #774b52; }
    .log-text.muted { color: #2587c8; }
    .log-cursor {
      display: inline-block;
      width: 6px; height: 10px;
      background: #2587c8;
      animation: blink 1s step-end infinite;
      vertical-align: middle;
      margin-left: 2px;
    }
    @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
    .log-gh-link {
      margin-top: 8px;
      font-size: 8px;
      color: #306e7b;
      letter-spacing: 0.1em;
      text-decoration: none;
      text-transform: uppercase;
      display: inline-block;
    }
    .log-gh-link:hover { color: #2587c8; }

    .watermark { position: fixed; bottom: 14px; right: 16px; font-size: 8px; color: #b8d9eb; letter-spacing: 0.08em; font-family: 'IBM Plex Mono', monospace; user-select: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="headline">FISH<br>STALE.</div>
    <div class="subtext">Data old. People mad. Fix now.</div>
    <button class="btn" id="btn" onclick="runSync()">
      <span class="btn-icon" id="btn-icon">
        <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </span>
      <span id="btn-label">REFRESH</span>
    </button>
    <div class="status" id="status"></div>

    <div class="log-wrap" id="log-wrap">
      <div class="log-header">Sync log</div>
      <div class="log-box" id="log-box"></div>
      <a class="log-gh-link" id="log-gh-link" href="#" target="_blank" rel="noopener" style="display:none">View on GitHub &rarr;</a>
    </div>
  </div>
  <div class="watermark">schnapp.bet/fish</div>

  <script>
    let running = false;
    let pollTimer = null;
    let knownLineCount = 0;
    let cursorEl = null;

    function addLogLine(time, text, cls) {
      const box = document.getElementById('log-box');
      if (cursorEl && cursorEl.parentNode) { cursorEl.parentNode.removeChild(cursorEl); cursorEl = null; }

      const row = document.createElement('div');
      row.className = 'log-line';

      const t = document.createElement('span');
      t.className = 'log-time';
      t.textContent = time;

      const m = document.createElement('span');
      m.className = 'log-text' + (cls ? ' ' + cls : '');
      m.textContent = text;

      row.appendChild(t);
      row.appendChild(m);
      box.appendChild(row);
      box.scrollTop = box.scrollHeight;
    }

    function addCursor() {
      const box = document.getElementById('log-box');
      if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
      cursorEl = document.createElement('div');
      cursorEl.className = 'log-line';
      const t = document.createElement('span'); t.className = 'log-time'; t.textContent = '';
      const m = document.createElement('span'); m.className = 'log-text muted';
      const c = document.createElement('span'); c.className = 'log-cursor';
      m.appendChild(c); cursorEl.appendChild(t); cursorEl.appendChild(m);
      box.appendChild(cursorEl);
      box.scrollTop = box.scrollHeight;
    }

    function classFor(text) {
      if (text.includes('FAILED') || text.endsWith('ERR)') || text === 'FETCH FAILED') return 'err';
      if (text.startsWith('DONE.')) return 'ok';
      return '';
    }

    async function poll(runId) {
      try {
        const res = await fetch('/api/fish-sync/status?runId=' + runId);
        if (!res.ok) return;
        const data = await res.json();

        const newLines = data.lines.slice(knownLineCount);
        for (const ln of newLines) {
          addLogLine(ln.time, ln.text, classFor(ln.text));
          knownLineCount++;
        }
        if (newLines.length) addCursor();

        if (data.runUrl) {
          const link = document.getElementById('log-gh-link');
          link.href = data.runUrl;
          link.style.display = 'inline-block';
        }

        if (data.done) {
          clearInterval(pollTimer); pollTimer = null;
          if (cursorEl && cursorEl.parentNode) { cursorEl.parentNode.removeChild(cursorEl); cursorEl = null; }

          const btn = document.getElementById('btn');
          const icon = document.getElementById('btn-icon');
          const label = document.getElementById('btn-label');
          const status = document.getElementById('status');

          if (data.failed) {
            btn.className = 'btn state-error';
            icon.className = 'btn-icon';
            label.textContent = 'REFRESH';
            status.className = 'status error';
            status.textContent = 'Run failed.';
          } else {
            btn.className = 'btn state-success';
            icon.className = 'btn-icon';
            label.textContent = 'FISH FRESH NOW';
            status.className = 'status ok';
            status.textContent = 'Last refresh: just now';
            setTimeout(() => { btn.className = 'btn'; label.textContent = 'REFRESH'; }, 3500);
          }
          running = false;
        }
      } catch (e) { /* keep trying */ }
    }

    async function runSync() {
      if (running) return;
      running = true;

      const btn = document.getElementById('btn');
      const icon = document.getElementById('btn-icon');
      const label = document.getElementById('btn-label');
      const status = document.getElementById('status');
      const logWrap = document.getElementById('log-wrap');
      const logBox = document.getElementById('log-box');

      btn.className = 'btn state-running';
      icon.className = 'btn-icon spinning';
      label.textContent = 'FETCHING...';
      status.className = 'status running';
      status.textContent = '';

      logBox.innerHTML = '';
      knownLineCount = 0;
      logWrap.classList.add('visible');
      addCursor();

      try {
        const res = await fetch('/api/fish-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();

        if (!res.ok || !data.runId) {
          if (cursorEl && cursorEl.parentNode) { cursorEl.parentNode.removeChild(cursorEl); cursorEl = null; }
          addLogLine('--:--:--', data.error ?? 'DISPATCH FAILED', 'err');
          btn.className = 'btn state-error';
          icon.className = 'btn-icon';
          label.textContent = 'REFRESH';
          status.className = 'status error';
          status.textContent = data.error ?? 'Dispatch failed.';
          running = false;
          return;
        }

        label.textContent = 'RUNNING...';
        pollTimer = setInterval(() => poll(data.runId), 3000);
        poll(data.runId);
      } catch (e) {
        if (cursorEl && cursorEl.parentNode) { cursorEl.parentNode.removeChild(cursorEl); cursorEl = null; }
        addLogLine('--:--:--', e.message ?? 'UNKNOWN ERROR', 'err');
        btn.className = 'btn state-error';
        icon.className = 'btn-icon';
        label.textContent = 'REFRESH';
        status.className = 'status error';
        status.textContent = e.message ?? 'Unknown error.';
        running = false;
      }
    }
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
