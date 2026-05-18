# Runbooks

Operational procedures for the schnapp-bet stack. Each runbook is task-scoped: read the one you need; do not read the whole directory.

## Contents

- [deploy-web.md](deploy-web.md) — Manual deploy of the Next.js web tier on Schnapps-MBP. Includes rollback.
- [runner-and-services.md](runner-and-services.md) — Mac-runner, Flask runner, MCP server: status, restart, log access.
- [tunnels-and-dns.md](tunnels-and-dns.md) — Cloudflare tunnel and DNS recovery for the `schnapp-mac` tunnel and the seven public subdomains.

## When to use these vs CONNECTIONS.md

- `docs/CONNECTIONS.md` is the **identity** of every external system: what runs where, what secret authenticates it, what the address is. Read it to answer "where does X live?"
- The runbooks are the **action**: how to restart, deploy, recover. Read them to answer "how do I fix X?"

When the action and the identity overlap (e.g., the deploy step lists which plist gets reloaded), the runbook references CONNECTIONS.md rather than duplicating.
