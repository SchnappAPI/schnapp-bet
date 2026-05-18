---
paths:
  - "services/flask/**"
---

- `services/flask/runner.py` is a stateless proxy to NBA CDN. It has no database connection and writes no data.
- Routes: `/ping` (no auth), `/scoreboard` (X-Runner-Key required), `/boxscore?gameId=` (X-Runner-Key required).
- `RUNNER_API_KEY` gates `/scoreboard` and `/boxscore`. Read from env via the launchd plist. Never hardcode.
- Bind address: `0.0.0.0:5000`. Public hostname: `https://mac-flask.schnapp.bet` via the `schnapp-mac` Cloudflare tunnel.
- NBA CDN base URL: `https://cdn.nba.com/static/json/liveData/`. No proxy needed.
- Playoff game IDs use the `004` prefix; regular season uses `002`. Live-data callers should not assume either.
- Run by launchd user agent `bet.schnapp.flask` (`~/Library/LaunchAgents/bet.schnapp.flask.plist`, RunAtLoad=true, KeepAlive=true).
- Reload after a plist change: `launchctl bootout user/$(id -u) bet.schnapp.flask` then `launchctl bootstrap user/$(id -u) ~/Library/LaunchAgents/bet.schnapp.flask.plist`. Do not use `kickstart -k` for plist reloads.
- Restart without a plist change: `launchctl kickstart -k user/$(id -u) bet.schnapp.flask` (or use the Mac MCP `flask_restart` tool).
- Verify after restart: `curl https://mac-flask.schnapp.bet/ping` should return `{"ok":true}`.
- Log tail: `tail -f ~/services/flask/flask.log` via Mac MCP `shell_exec`.
