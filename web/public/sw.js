// CACHE_NAME placeholder is replaced with the 8-char commit SHA by deploy-web.yml
// before npm run build. Falls back to '540dee4' literal in local development.
const CACHE_NAME = 'schnapp-shell-540dee4';

// App shell assets to cache on install. Next.js generates hashed filenames
// for JS/CSS chunks — those are cached on first fetch below.
const SHELL_URLS = [
  '/',
  '/nba',
  '/nba/grades',
  '/mlb',
  '/offline.html',
];

// API caching strategies — kept in sync with web/next.config.mjs Cache-Control
// table and the SWR refreshInterval values used on the client.
//
// network-first (with 3s timeout, falls back to cache): live routes where
//   freshness wins over speed. Cache fills as a safety net.
// stale-while-revalidate: serve cache immediately, fetch in background to
//   update for next time. Best UX on slow mobile.
// cache-first: historical / near-immutable data.
// passthrough: private or write routes — never touched.
const NETWORK_FIRST = [/^\/api\/games(\/today)?$/, /^\/api\/scoreboard$/, /^\/api\/boxscore$/];
const STALE_WHILE_REVALIDATE = [/^\/api\/grades(\/.*)?$/, /^\/api\/player-grades$/, /^\/api\/tier-grid$/];
const CACHE_FIRST = [/^\/api\/player\/[^/]+\/history$/];
const NETWORK_ONLY = [/^\/api\/search$/, /^\/api\/refresh-/, /^\/api\/auth\//];

const NETWORK_TIMEOUT_MS = 3000;

function matchAny(patterns, pathname) {
  for (const p of patterns) if (p.test(pathname)) return true;
  return false;
}

function timeoutFetch(request, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/.auth/')) return;

  // API route caching strategies.
  if (url.pathname.startsWith('/api/')) {
    if (matchAny(NETWORK_ONLY, url.pathname)) return; // passthrough

    if (matchAny(NETWORK_FIRST, url.pathname)) {
      event.respondWith(
        timeoutFetch(event.request, NETWORK_TIMEOUT_MS)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => caches.match(event.request).then((cached) => cached ?? Response.error()))
      );
      return;
    }

    if (matchAny(STALE_WHILE_REVALIDATE, url.pathname)) {
      event.respondWith(
        caches.match(event.request).then((cached) => {
          const networkPromise = fetch(event.request)
            .then((response) => {
              if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
              }
              return response;
            })
            .catch(() => cached ?? Response.error());
          return cached ?? networkPromise;
        })
      );
      return;
    }

    if (matchAny(CACHE_FIRST, url.pathname)) {
      event.respondWith(
        caches.match(event.request).then(
          (cached) =>
            cached ??
            fetch(event.request).then((response) => {
              if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
              }
              return response;
            })
        )
      );
      return;
    }

    return; // unmatched API routes pass through to network
  }

  // Navigation requests (HTML pages): network first, fall back to cache, then offline page.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(
            (cached) => cached ?? caches.match('/offline.html')
          )
        )
    );
    return;
  }

  // Static assets (JS, CSS, fonts, images): cache first, then network.
  // Next.js hashes these filenames so stale cache is never an issue.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff')
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ??
          fetch(event.request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return response;
          })
      )
    );
    return;
  }
});
