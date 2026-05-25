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
      color: #8aaabb;
      margin-bottom: 8px;
    }
    .log-box {
      background: #0a2a40;
      padding: 14px 16px;
      min-height: 48px;
      max-height: 260px;
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
      animation: fadein 0.25s ease forwards;
    }
    @keyframes fadein { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
    .log-time {
      font-size: 9px;
      color: #4a7a9a;
      flex-shrink: 0;
      letter-spacing: 0.04em;
    }
    .log-text {
      font-size: 10px;
      color: #c8e0f0;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 500;
    }
    .log-text.ok   { color: #5aba88; }
    .log-text.err  { color: #e06060; }
    .log-text.muted { color: #4a7a9a; }
    .log-cursor {
      display: inline-block;
      width: 6px; height: 10px;
      background: #4a7a9a;
      animation: blink 1s step-end infinite;
      vertical-align: middle;
      margin-left: 2px;
    }
    @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
    .log-gh-link {
      margin-top: 8px;
      font-size: 8px;
      color: #4a7a9a;
      letter-spacing: 0.1em;
      text-decoration: none;
      text-transform: uppercase;
      display: inline-block;
    }
    .log-gh-link:hover { color: #8aaabb; }

    .watermark { position: fixed; bottom: 14px; right: 16px; font-size: 8px; color: #c0d0e0; letter-spacing: 0.08em; font-family: 'IBM Plex Mono', monospace; user-select: none; }
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

      // Remove cursor from wherever it is
      if (cursorEl && cursorEl.parentNode) {
        cursorEl.parentNode.removeChild(cursorEl);
        cursorEl = null;
      }

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
      return row;
    }

    function addCursor() {
      const box = document.getElementById('log-box');
      if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
      cursorEl = document.createElement('div');
      cursorEl.className = 'log-line';
      const t = document.createElement('span');
      t.className = 'log-time';
      t.textContent = '';
      const m = document.createElement('span');
      m.className = 'log-text muted';
      const c = document.createElement('span');
      c.className = 'log-cursor';
      m.appendChild(c);
      cursorEl.appendChild(t);
      cursorEl.appendChild(m);
      box.appendChild(cursorEl);
      box.scrollTop = box.scrollHeight;
    }

    function classFor(text) {
      if (text.includes('FAILED') || text.includes('ERR')) return 'err';
      if (text.startsWith('DONE.')) return 'ok';
      return '';
    }

    async function poll(runId) {
      try {
        const res = await fetch('/api/fish-sync/status?runId=' + runId);
        if (!res.ok) return;
        const data = await res.json();

        // Render any new lines
        const newLines = data.lines.slice(knownLineCount);
        for (const ln of newLines) {
          addLogLine(ln.time, ln.text, classFor(ln.text));
          knownLineCount++;
        }

        if (data.runUrl) {
          const link = document.getElementById('log-gh-link');
          link.href = data.runUrl;
          link.style.display = 'inline-block';
        }

        if (data.done) {
          clearInterval(pollTimer);
          pollTimer = null;
          if (cursorEl && cursorEl.parentNode) { cursorEl.parentNode.removeChild(cursorEl); cursorEl = null; }

          const btn    = document.getElementById('btn');
          const icon   = document.getElementById('btn-icon');
          const label  = document.getElementById('btn-label');
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
            setTimeout(() => {
              btn.className = 'btn';
              label.textContent = 'REFRESH';
            }, 3500);
          }
          running = false;
        }
      } catch (e) {
        // swallow poll errors; keep trying
      }
    }

    async function runSync() {
      if (running) return;
      running = true;

      const btn    = document.getElementById('btn');
      const icon   = document.getElementById('btn-icon');
      const label  = document.getElementById('btn-label');
      const status = document.getElementById('status');
      const logWrap = document.getElementById('log-wrap');
      const logBox  = document.getElementById('log-box');

      btn.className = 'btn state-running';
      icon.className = 'btn-icon spinning';
      label.textContent = 'FETCHING...';
      status.className = 'status running';
      status.textContent = '';

      // Reset log
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
        pollTimer = setInterval(() => poll(data.runId), 5000);
        poll(data.runId); // immediate first poll
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
