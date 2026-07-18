// schnapp-failover Worker: origin-first, snapshot-on-outage.
//
// Every request first goes to the real origin (the cloudflared tunnel to
// the Mac). Only when that fails in a way that means "origin unreachable"
// (tunnel-down class statuses or a timeout) does the Worker fall back to
// the R2 snapshot, injecting a visible stale-data banner into HTML.
// Health check is inline per request - no paid Load Balancer.

const ORIGIN_TIMEOUT_MS = 5000;
// 502/504: cloudflared up but local service dead. 52x/530: tunnel down.
const OUTAGE_STATUSES = new Set([
  502, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530,
]);
const MANIFEST_TTL_MS = 60_000;

let manifestCache = { ts: null, fetchedAt: 0 };

export default {
  async fetch(request, env) {
    let originResp = null;
    try {
      originResp = await fetch(request, {
        signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
      });
    } catch {
      originResp = null; // network error / timeout -> treat as outage
    }
    if (originResp && !OUTAGE_STATUSES.has(originResp.status))
      return originResp;
    return serveSnapshot(request, env, originResp);
  },
};

async function serveSnapshot(request, env, originResp) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(
      503,
      "Site is in read-only backup mode; writes are unavailable.",
    );
  }

  const url = new URL(request.url);
  const obj = await lookup(env, url);
  if (!obj) {
    const accepts = request.headers.get("accept") || "";
    if (accepts.includes("text/html"))
      return outagePage(await snapshotTimestamp(env));
    // Prefer the origin's own error over an invented one when we have it.
    return (
      originResp ??
      jsonError(503, "Origin unreachable and no snapshot for this path.")
    );
  }

  const contentType =
    obj.httpMetadata?.contentType || "application/octet-stream";
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "no-store",
    "x-schnapp-failover": "snapshot",
  });

  if (contentType.includes("text/html")) {
    const ts = await snapshotTimestamp(env);
    const html = injectBanner(await obj.text(), ts);
    return new Response(request.method === "HEAD" ? null : html, { headers });
  }
  return new Response(request.method === "HEAD" ? null : obj.body, { headers });
}

async function lookup(env, url) {
  // Keys mirror snapshot_push.py key_for(): API URLs keep their query
  // string (exact-match the client fetch URL), pages/assets are bare
  // pathnames, "/" is stored as index.html.
  if (url.pathname.startsWith("/api/")) {
    const exact = await env.SNAPSHOT.get(url.pathname.slice(1) + url.search);
    if (exact) return exact;
    return url.search ? env.SNAPSHOT.get(url.pathname.slice(1)) : null;
  }
  const key = url.pathname.slice(1) || "index.html";
  return env.SNAPSHOT.get(key);
}

async function snapshotTimestamp(env) {
  const now = Date.now();
  if (manifestCache.ts && now - manifestCache.fetchedAt < MANIFEST_TTL_MS)
    return manifestCache.ts;
  try {
    const obj = await env.SNAPSHOT.get("manifest.json");
    if (obj) {
      const m = await obj.json();
      manifestCache = { ts: m.generated_at, fetchedAt: now };
      return m.generated_at;
    }
  } catch {}
  return manifestCache.ts || "unknown";
}

function injectBanner(html, ts) {
  // Appended after `load` (post-hydration) so React never sees the extra
  // node during hydration of the snapshotted app-router document.
  const banner =
    `<script>(function(){function add(){var d=document.createElement("div");` +
    `d.id="sb-failover-banner";` +
    `d.textContent="Backup copy - live site unreachable. Data as of ${escapeJs(formatTs(ts))}";` +
    `d.style.cssText="position:fixed;top:0;left:0;right:0;z-index:2147483647;` +
    `background:#b45309;color:#fff;text-align:center;` +
    `font:600 13px/1.4 system-ui,sans-serif;padding:6px 10px;";` +
    `document.body.appendChild(d);document.body.style.paddingTop="30px";}` +
    `if(document.readyState==="complete"){setTimeout(add,60);}` +
    `else{window.addEventListener("load",function(){setTimeout(add,60);});}})();</script>`;
  const i = html.lastIndexOf("</body>");
  return i === -1 ? html + banner : html.slice(0, i) + banner + html.slice(i);
}

function formatTs(ts) {
  const d = new Date(ts);
  return isNaN(d) ? String(ts) : d.toUTCString();
}

function escapeJs(s) {
  return String(s).replace(
    /[\\"<]/g,
    (c) => ({ "\\": "\\\\", '"': '\\"', "<": "\\u003c" })[c],
  );
}

function outagePage(ts) {
  const body =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>schnapp.bet - backup mode</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem">` +
    `<h1 style="font-size:1.3rem">schnapp.bet is in backup mode</h1>` +
    `<p>The live site is unreachable and this page has no saved copy.</p>` +
    `<p>Snapshot data as of <strong>${formatTs(ts)}</strong>.</p>` +
    `<p>Saved pages: <a href="/">home</a> - <a href="/nba">NBA</a> - ` +
    `<a href="/mlb">MLB</a> - <a href="/nfl">NFL</a></p></body></html>`;
  return new Response(body, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-schnapp-failover": "outage-page",
    },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message, failover: true }), {
    status,
    headers: {
      "content-type": "application/json",
      "x-schnapp-failover": "snapshot",
    },
  });
}
