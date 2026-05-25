import { NextResponse } from 'next/server';

export async function GET() {
  const CHECK = '<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8.25" fill="#4e7e70"/><polyline points="5,9.5 7.5,12 13,6.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
  const ERR   = '<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8.25" fill="#774b52"/><line x1="6" y1="6" x2="12" y2="12" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><line x1="12" y1="6" x2="6" y2="12" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const ROWS = [
    { id: "fetch_unit_directory",              pending: "Fetch records from /unit_directory.json",                          active: "Fetching records from /unit_directory.json..." },
    { id: "fetch_unit_vacancy",                pending: "Fetch records from /unit_vacancy.json",                            active: "Fetching records from /unit_vacancy.json..." },
    { id: "fetch_property_custom_fields",      pending: "Fetch records from /property_custom_fields.json",                  active: "Fetching records from /property_custom_fields.json..." },
    { id: "fetch_unit_custom_fields",          pending: "Fetch records from /unit_custom_fields.json",                      active: "Fetching records from /unit_custom_fields.json..." },
    { id: "fetch_tenant_directory",            pending: "Fetch records from /tenant_directory.json",                        active: "Fetching records from /tenant_directory.json..." },
    { id: "fetch_rental_applications_pending", pending: "Fetch records from /rental_applications.json (pending)",           active: "Fetching records from /rental_applications.json (pending)..." },
    { id: "fetch_rental_applications_leases",  pending: "Fetch records from /rental_applications.json (leases mtd)",        active: "Fetching records from /rental_applications.json (leases mtd)..." },
    { id: "fetch_tenant_tickler",              pending: "Fetch records from /tenant_tickler.json",                          active: "Fetching records from /tenant_tickler.json..." },
    { id: "transform_units",                   pending: "Transform unit records",                                           active: "Transforming unit records..." },
    { id: "transform_residents",               pending: "Transform resident records",                                       active: "Transforming resident records..." },
    { id: "transform_occupancy",               pending: "Calculate occupancy",                                              active: "Calculating occupancy..." },
    { id: "dropbox_units",                     pending: "Upload Units -> /QuickBase Sync/Units/ (mode=overwrite)",           active: "Uploading Units -> /QuickBase Sync/Units/..." },
    { id: "dropbox_residents",                 pending: "Upload Residents -> /QuickBase Sync/Residents/ (mode=overwrite)",  active: "Uploading Residents -> /QuickBase Sync/Residents/..." },
    { id: "dropbox_occupancy",                 pending: "Upload Occupancy -> /QuickBase Sync/Occupancy Report/ (mode=add)", active: "Uploading Occupancy -> /QuickBase Sync/Occupancy Report/..." },
    { id: "sleep",                             pending: "Wait 30s for Dropbox to register files",                          active: "Waiting 30s for Dropbox to register files..." },
    { id: "qb_units",                          pending: "Trigger Units table refresh",                                     active: "Triggering Units table refresh..." },
    { id: "qb_residents",                      pending: "Trigger Residents table refresh",                                 active: "Triggering Residents table refresh..." },
    { id: "qb_occupancy",                      pending: "Trigger Occupancy Reports table refresh",                         active: "Triggering Occupancy Reports table refresh..." },
    { id: "job_complete",                      pending: "Await job completion",                                            active: "Awaiting job completion..." },
  ];

  const rowsJson = JSON.stringify(ROWS);

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
    body { min-height: 100vh; background: #f0f6fc; display: flex; align-items: flex-start; justify-content: center; font-family: 'IBM Plex Mono', monospace; padding: 48px 0 64px; }
    .container { width: 100%; max-width: 520px; padding: 0 24px; display: flex; flex-direction: column; align-items: center; text-align: center; }
    .headline { font-family: 'Bebas Neue', sans-serif; font-size: clamp(52px, 14vw, 88px); color: #003057; line-height: 0.88; letter-spacing: 0.04em; user-select: none; }
    .subtext { font-size: 10px; color: #306e7b; letter-spacing: 0.15em; text-transform: uppercase; margin-top: 14px; margin-bottom: 32px; }
    .btn { position: relative; width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; background: #004b87; color: #f8fafb; font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 0.12em; padding: 16px 32px; border: none; cursor: pointer; transition: background 0.18s, transform 0.18s, box-shadow 0.18s; outline: none; }
    .btn:not(.state-running):hover { background: #003057; transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,48,87,.32); }
    .btn.state-running { opacity: .75; cursor: not-allowed; pointer-events: none; }
    .btn.state-success { background: #306e7b; }
    .btn.state-error   { background: #774b52; }
    .btn-icon { width: 18px; height: 18px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .btn-icon svg { width: 18px; height: 18px; fill: none; stroke: #b8d9eb; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .spinning svg { animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status { margin-top: 12px; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: #306e7b; min-height: 14px; }
    .status.ok      { color: #4e7e70; }
    .status.running { color: #2587c8; }
    .status.error   { color: #774b52; }
    .steps-wrap { width: 100%; margin-top: 28px; display: none; flex-direction: column; text-align: left; }
    .steps-wrap.visible { display: flex; }
    .steps-header { font-size: 8px; letter-spacing: .18em; text-transform: uppercase; color: #306e7b; margin-bottom: 10px; }
    .steps-list { background: #fff; border: 1px solid #cddde8; }
    .step-row { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid #e4eef5; }
    .step-row:last-child { border-bottom: none; }
    .step-icon { flex-shrink: 0; width: 18px; height: 18px; position: relative; }
    .ic-ring { position: absolute; inset: 1px; border-radius: 50%; border: 1.5px solid #b8d9eb; }
    .ic-spin { display: none; position: absolute; inset: 1px; border-radius: 50%; border: 2px solid #b8d9eb; border-top-color: #2587c8; animation: spin .7s linear infinite; }
    .ic-check, .ic-err { display: none; position: absolute; inset: 0; }
    .state-active .ic-ring  { display: none; }
    .state-active .ic-spin  { display: block; }
    .state-done   .ic-ring  { display: none; }
    .state-done   .ic-check { display: block; }
    .state-error  .ic-ring  { display: none; }
    .state-error  .ic-err   { display: block; }
    .step-label { flex: 1; font-size: 9.5px; letter-spacing: .04em; line-height: 1.45; color: #b8d9eb; transition: color .2s; }
    .state-active .step-label { color: #306e7b; }
    .state-done   .step-label { color: #003057; }
    .state-error  .step-label { color: #774b52; }
    .step-dur { flex-shrink: 0; font-size: 8px; color: #306e7b; opacity: 0; transition: opacity .2s; letter-spacing: .02em; }
    .state-done  .step-dur { opacity: 1; }
    .state-error .step-dur { opacity: 1; }
    .watermark { position: fixed; bottom: 14px; right: 16px; font-size: 8px; color: #b8d9eb; letter-spacing: .08em; user-select: none; }
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
    <div class="steps-wrap" id="steps-wrap">
      <div class="steps-header">Sync steps</div>
      <div class="steps-list" id="steps-list"></div>
    </div>
  </div>
  <div class="watermark">schnapp.bet/fish</div>
  <script>
    const CHECK_SVG = ${JSON.stringify(CHECK)};
    const ERR_SVG   = ${JSON.stringify(ERR)};
    const ROWS = ${rowsJson};
    let running = false, pollTimer = null;

    function fmtDur(s) {
      if (s < 60) return s + 's';
      return Math.floor(s/60) + 'm ' + (s%60) + 's';
    }

    const COLLAPSED = [
      {id:'c_export',  label:'Fetching data from AppFolio...',  groupIds:['fetch_unit_directory','fetch_unit_vacancy','fetch_property_custom_fields','fetch_unit_custom_fields','fetch_tenant_directory','fetch_rental_applications_pending','fetch_rental_applications_leases','fetch_tenant_tickler','transform_units','transform_residents','transform_occupancy']},
      {id:'c_dropbox', label:'Uploading CSVs to Dropbox...',    groupIds:['dropbox_units','dropbox_residents','dropbox_occupancy']},
    ];
    const SOLO_IDS = ['sleep','qb_units','qb_residents','qb_occupancy','job_complete'];

    function makeRow(id, lbl) {
      const el = document.createElement('div');
      el.className = 'step-row state-pending';
      el.id = 'row-' + id;
      el.innerHTML =
        '<span class="step-icon"><span class="ic-ring"></span><span class="ic-spin"></span>' +
        '<span class="ic-check">' + CHECK_SVG + '</span><span class="ic-err">' + ERR_SVG + '</span></span>' +
        '<span class="step-label">' + lbl + '</span><span class="step-dur"></span>';
      return el;
    }

    function buildStepList() {
      const list = document.getElementById('steps-list');
      list.innerHTML = '';
      for (const c of COLLAPSED) list.appendChild(makeRow(c.id, c.label));
      const byId = {};
      for (const r of ROWS) byId[r.id] = r;
      for (const id of SOLO_IDS) list.appendChild(makeRow(id, byId[id].pending));
    }

    function applyRows(apiRows) {
      const byId = {};
      for (const r of ROWS) byId[r.id] = r;
      const list = document.getElementById('steps-list');
      const doneRows = apiRows.filter(r=>(r.state==='done'||r.state==='error')&&r.elapsedSeconds!=null).sort((a,b)=>a.elapsedSeconds-b.elapsedSeconds);
      const stepDur = {}; let prev=0;
      for (const r of doneRows) { stepDur[r.id]=r.elapsedSeconds-prev; prev=r.elapsedSeconds; }

      for (const c of COLLAPSED) {
        const allDone = c.groupIds.every(id => { const r = apiRows.find(x=>x.id===id); return r&&(r.state==='done'||r.state==='error'); });
        const anyStarted = c.groupIds.some(id => { const r = apiRows.find(x=>x.id===id); return r&&r.state!=='pending'; });
        const col = document.getElementById('row-'+c.id);
        if (allDone) {
          if (col) {
            for (const id of c.groupIds)
              if (!document.getElementById('row-'+id)) list.insertBefore(makeRow(id,''), col);
            col.remove();
          }
          for (const id of c.groupIds) {
            const el = document.getElementById('row-'+id); if (!el) continue;
            const r = apiRows.find(x=>x.id===id); if (!r) continue;
            el.className = 'step-row state-'+r.state;
            const lb = el.querySelector('.step-label'), du = el.querySelector('.step-dur');
            lb.textContent = (r.state==='done'||r.state==='error') ? r.done : byId[id].pending;
            if ((r.state==='done'||r.state==='error')&&r.elapsedSeconds!=null) du.textContent=fmtDur(stepDur[r.id]!=null?stepDur[r.id]:r.elapsedSeconds);
          }
        } else if (col) {
          col.className = 'step-row state-'+(anyStarted?'active':'pending');
          col.querySelector('.step-label').textContent = c.label;
        }
      }

      for (const r of apiRows) {
        if (!SOLO_IDS.includes(r.id)) continue;
        const el = document.getElementById('row-'+r.id); if (!el) continue;
        el.className = 'step-row state-'+r.state;
        const lb = el.querySelector('.step-label'), du = el.querySelector('.step-dur');
        if (r.state==='pending')      lb.textContent = byId[r.id].pending;
        else if (r.state==='active')  lb.textContent = byId[r.id].active;
        else                          lb.textContent = r.done;
        if ((r.state==='done'||r.state==='error')&&r.elapsedSeconds!=null) du.textContent=fmtDur(stepDur[r.id]!=null?stepDur[r.id]:r.elapsedSeconds);
      }
    }

    async function poll(runId) {
      try {
        const res = await fetch('/api/fish-sync/status?runId=' + runId);
        if (!res.ok) return;
        const data = await res.json();
        applyRows(data.rows);
        if (data.done) {
          clearInterval(pollTimer); pollTimer = null;
          const btn = document.getElementById('btn');
          const icon = document.getElementById('btn-icon');
          const lbl = document.getElementById('btn-label');
          const st = document.getElementById('status');
          if (data.failed) {
            btn.className = 'btn state-error'; icon.className = 'btn-icon';
            lbl.textContent = 'REFRESH'; st.className = 'status error'; st.textContent = 'Run failed.';
          } else {
            btn.className = 'btn state-success'; icon.className = 'btn-icon';
            lbl.textContent = 'FISH FRESH NOW'; st.className = 'status ok'; st.textContent = 'Last refresh: just now';
            setTimeout(() => { btn.className = 'btn'; lbl.textContent = 'REFRESH'; }, 3500);
          }
          running = false;
        }
      } catch(e) {}
    }

    async function runSync() {
      if (running) return;
      running = true;
      const btn = document.getElementById('btn');
      const icon = document.getElementById('btn-icon');
      const lbl = document.getElementById('btn-label');
      const st = document.getElementById('status');
      const wrap = document.getElementById('steps-wrap');
      btn.className = 'btn state-running'; icon.className = 'btn-icon spinning';
      lbl.textContent = 'FETCHING...'; st.className = 'status running'; st.textContent = '';
      buildStepList();
      wrap.classList.add('visible');
      try {
        const res = await fetch('/api/fish-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (!res.ok || !data.runId) {
          btn.className = 'btn state-error'; icon.className = 'btn-icon';
          lbl.textContent = 'REFRESH'; st.className = 'status error'; st.textContent = data.error || 'Dispatch failed.';
          running = false; return;
        }
        lbl.textContent = 'RUNNING...';
        pollTimer = setInterval(() => poll(data.runId), 3000);
        poll(data.runId);
      } catch(e) {
        btn.className = 'btn state-error'; icon.className = 'btn-icon';
        lbl.textContent = 'REFRESH'; st.className = 'status error'; st.textContent = e.message || 'Unknown error.';
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
