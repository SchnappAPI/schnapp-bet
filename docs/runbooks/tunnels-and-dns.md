# Runbook: Cloudflare Tunnel and DNS

The `schnapp-mac` Cloudflare tunnel (ID `844a3714-9bd3-409e-a672-a6840c94e68e`) exposes Schnapps-MBP-hosted services as public Cloudflare-proxied subdomains. Config: `/etc/cloudflared/config.yml`. System-level launchd job: `com.cloudflare.cloudflared`.

## Public subdomains

| Subdomain                        | Backend on Mac                                                                                     | Purpose                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `schnapp.bet`, `www.schnapp.bet` | Next.js prod `127.0.0.1:3001`                                                                      | Production web                             |
| `prod.schnapp.bet`               | Next.js prod `127.0.0.1:3001`                                                                      | Alias (pre-cutover staging hostname, kept) |
| `dev.schnapp.bet`                | Next.js dev `127.0.0.1:3000` (interactive only — `npm run dev` from `web/`, no auto-managed agent) | Dev / staging                              |
| `mac-flask.schnapp.bet`          | Flask `127.0.0.1:5000`                                                                             | Web app live-data routes                   |
| `mac-mcp.schnapp.bet`            | Mac MCP `127.0.0.1:8765`                                                                           | Claude MCP connector                       |

All are Cloudflare-proxied (orange cloud). Do not flip any to DNS-only.

## Status checks

```bash
# Is cloudflared running on the Mac?
sudo launchctl list | grep com.cloudflare.cloudflared

# Tunnel status
cloudflared tunnel info schnapp-mac

# DNS resolution
dig +short schnapp.bet
dig +short mac-flask.schnapp.bet
```

A subdomain returning 502 from Cloudflare's edge usually means cloudflared is down or the backend service is.

## Recovery

### Tunnel down (multiple subdomains returning 502)

```bash
sudo launchctl kickstart -k system/com.cloudflare.cloudflared
```

Wait ~10 seconds and re-test with `curl -sI https://mac-flask.schnapp.bet/ping`.

### Single subdomain failing

Most likely the backend service, not the tunnel. Check the corresponding agent:

- `schnapp.bet` 503 → `bet.schnapp.web-prod` agent. See [deploy-web.md](deploy-web.md).
- `mac-flask.schnapp.bet` failing → see [runner-and-services.md](runner-and-services.md) Flask section.
- `mac-mcp.schnapp.bet` failing → see [runner-and-services.md](runner-and-services.md) MCP section.

### Tunnel config change

`/etc/cloudflared/config.yml` defines ingress rules per hostname. After editing:

```bash
sudo launchctl kickstart -k system/com.cloudflare.cloudflared
```

Add or remove DNS routes via:

```bash
cloudflared tunnel route dns schnapp-mac new-subdomain.schnapp.bet
```

## Cloudflare API (cached locally)

`~/.cloudflared/cert.pem` holds the origin cert. Do not commit; do not rotate without coordinating with the team — losing it requires re-registering the tunnel from scratch.

## Keep-alive

Uptime Robot monitor `schnapp-bet-ping` is paused. `keepalive.yml` (if it lands in this repo) should remain dispatch-only and not rescheduled without a deliberate decision to reverse the tradeoff. The web `/api/ping` route is available for resuming the monitor if a paying user tier ever requires warm web response times.
