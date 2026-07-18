# ADR-20260718-1 — Active-passive failover: R2 snapshot push + edge Worker fallback

Date: 2026-07-18
Status: Accepted

## Context

schnapp.bet is served from the Mac through a cloudflared tunnel (`schnapp.bet` → `127.0.0.1:3001`). A 2026-07 power outage took down the Mac and home internet simultaneously; every tunneled hostname returned Cloudflare 530 until power returned. The owner ruled out a UPS and any always-on paid standby in the 2026-07-14 design chat; the accepted contract is read-only degradation during outages, with stale content visibly labeled.

A pull-based standby (edge polling the origin for content) cannot work: a dead Mac cannot be polled. Cloudflare's Load Balancer product would health-check and steer, but is a paid, always-on component for a failure mode measured in hours per year.

The `CLOUDFLARE_API_TOKEN` item in the `web-variables` vault turned out to be a placeholder (token fails `/user/tokens/verify` outright, `cfat_` prefix is not a Cloudflare token format, the item's R2 S3 endpoint TLS-rejects, notes read "Example…"). There were no working Cloudflare API credentials to build on.

## Decision

1. **Active-passive with a serverless standby, ~$0 idle.** No Load Balancer, no standby server. Two components in `services/failover/`:
   - `snapshot_push.py` + `services/launchd/bet.schnapp.failover-snapshot.plist`: every 30 min, crawl `127.0.0.1:3001` (seed pages, depth-2 link discovery capped at 150, assets, `/qb`, today's slate-level API GETs using the exact client fetch URLs) and push hash-changed objects to R2 bucket `schnapp-bet-failover`. `manifest.json` (snapshot timestamp) uploads last so a partial push never advances the visible freshness time.
   - `worker/` (`schnapp-failover`) on routes `schnapp.bet/*` and `www.schnapp.bet/*`: forward each request to origin with a 5 s timeout; on timeout or outage-class status (502, 504, 520–527, 530) serve the R2 snapshot with an injected "Backup copy — data as of <ts>" banner. Health check is inline per request.
2. **Push, not pull.** The Mac initiates all snapshot transfer; the edge never depends on reaching the origin to have content.
3. **Wrangler OAuth, not an API token.** One interactive `npx wrangler login` on the Mac; the refresh token keeps the LaunchAgent non-interactive. Sidesteps minting and vaulting a scoped API token for a placeholder item, and grants nothing to CI (the job is Mac-local by design — only the Mac has the content).
4. **Banner injection is post-hydration.** The Worker appends a `<script>` that adds the banner after `window.load`, not a server-side DOM node, so React's whole-document hydration of the snapshotted app-router HTML never sees an unexpected element and silently falls back to client rendering (which would refetch dead APIs and blank the page).
5. **API snapshots are slate-level only, exact-URL keyed.** Query strings are part of the R2 key so SWR cache keys match during an outage. Per-game/per-player endpoints are excluded: unbounded fan-out for pages the read-only mode does not promise. Misses return a labeled 503 JSON.

## Consequences

- Outage behavior: main pages render with data as of the last snapshot (≤30 min stale) under an explicit banner; detail pages and off-snapshot dates degrade to error states; all writes 503.
- Every production request now transits the Worker (free-tier request budget applies; current traffic is far below it). The Worker forwards non-outage responses untouched, including 4xx/5xx that are the app's own.
- New moving part to keep honest: if the snapshot job dies, the failover serves increasingly stale data — the banner timestamp is the tell. Logs in `services/failover/`.
- One-time owner step (wrangler login + bucket create + deploy) documented in `services/failover/README.md`, plus an end-to-end outage simulation procedure.
- The placeholder `CLOUDFLARE_API_TOKEN` vault item is documented as unused by this layer; it was left in place (other consumers unknown).

## Out of scope

- Failover for non-site hostnames on the tunnel (`mac-mcp`, `console`, `obsidian-mcp`, `dev`, `mac-flask`, `prod`): infrastructure surfaces, not public content.
- Write-path continuity, live data during outages, and any freshness beyond the 30-min snapshot cadence.
- Alerting on snapshot-job failure (candidate follow-up, not decided here).
