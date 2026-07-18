# services/failover/

Active-passive failover for schnapp.bet. When the Mac or home internet dies,
every tunneled hostname returns Cloudflare 530; this layer keeps the public
site readable from the edge at ~$0 idle cost (no Load Balancer, no paid
standby).

Two halves:

1. **Snapshot push (Mac side)** - `snapshot_push.py`, run every 30 min by
   `services/launchd/bet.schnapp.failover-snapshot.plist`. Crawls the local
   prod server (`127.0.0.1:3001`): seed pages + discovered links (depth 2,
   cap 150), their `_next` / CSS / font / image assets, `/qb`, and the
   slate-level API GETs for today (ET) using the exact URLs the client
   components fetch. Pushes only hash-changed objects to the R2 bucket
   `schnapp-bet-failover` via `npx wrangler r2 object put`, then uploads
   `manifest.json` (snapshot timestamp) last, so a partial push never
   advances the visible "data as of" time. Push, not pull: a dead Mac
   cannot be polled. State (per-key content hashes) lives outside the repo
   at `~/.schnapp-failover-state.json`.

2. **Worker fallback (edge side)** - `worker/` (`schnapp-failover`), routed
   on `schnapp.bet/*` and `www.schnapp.bet/*`. Passes every request to the
   tunnel origin with a 5 s timeout; on timeout or an outage-class status
   (502, 504, 520-527, 530) it serves the R2 snapshot instead, injecting a
   fixed banner "Backup copy - live site unreachable. Data as of <ts>" into
   HTML (post-`load`, so React hydration never sees the extra node).
   Non-GET requests during an outage get a 503 read-only JSON error.
   Pages with no snapshot get a 503 outage page linking the saved sections.
   Responses served from snapshot carry `x-schnapp-failover: snapshot`.

Read-only degradation during outages is the accepted contract: detail pages
(per-game, per-player) and date params other than the snapshot day fall back
to error states; the banner explains why.

## Auth

Wrangler OAuth only - one interactive `npx wrangler login` on the Mac; the
refresh token in `~/Library/Preferences/.wrangler/` keeps the LaunchAgent
non-interactive afterwards. The `CLOUDFLARE_API_TOKEN` item in the
`web-variables` vault is a placeholder (invalid token, dead R2 endpoint) and
is not used.

## Deploy (one-time)

```bash
cd /Users/schnapp/code/schnapp-bet/services/failover/worker
npx --yes wrangler login
npx --yes wrangler r2 bucket create schnapp-bet-failover
npx --yes wrangler deploy
cd .. && python3 snapshot_push.py
cp /Users/schnapp/code/schnapp-bet/services/launchd/bet.schnapp.failover-snapshot.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/bet.schnapp.failover-snapshot.plist
curl -s -o /dev/null -w '%{http_code}\n' https://schnapp.bet/   # expect 200 (origin passthrough)
```

## Verify failover end to end

```bash
# 1. Simulate outage: stop the tunnel briefly.
sudo launchctl unload /Library/LaunchDaemons/com.cloudflare.cloudflared.plist 2>/dev/null || sudo brew services stop cloudflared
sleep 10
curl -si https://schnapp.bet/ | grep -e '^HTTP' -e 'x-schnapp-failover'   # expect 200 + x-schnapp-failover: snapshot
# 2. Restore.
sudo launchctl load /Library/LaunchDaemons/com.cloudflare.cloudflared.plist 2>/dev/null || sudo brew services start cloudflared
sleep 15
curl -si https://schnapp.bet/ | grep -e '^HTTP' -e 'x-schnapp-failover'   # expect 200, no failover header
```

## Ops notes

- Snapshot cadence: `StartInterval 1800`. Logs: `snapshot-push.log` /
  `snapshot-push.err.log` in this directory (gitignored).
- Wrangler v4 R2 object commands default to local simulation; the script
  passes `--remote` explicitly.
- Worker logic has a mock-based node test exercised at build time (origin
  passthrough, 530/timeout fallback, banner, API exact/query-miss, POST
  read-only, outage page); rerun ad hoc if `worker/src/index.js` changes.
- Individual failed page/API fetches during a crawl are skipped, not fatal;
  a crawl with no homepage refuses to push.
