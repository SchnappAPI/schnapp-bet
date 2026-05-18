# schnapp-bet

Player prop research platform for NBA, MLB, and NFL. Consumer site at `schnapp.bet`.

## Stack

- **Web**: Next.js 15 + React 19 + Tailwind. Launchd on Schnapps-MBP (port 3001).
- **Database**: SQL Server 2022 in Docker on Schnapps-MBP (`localhost,1433`).
- **ETL / Grading**: Python 3.12, GitHub Actions on `mac-runner-1` (self-hosted).
- **Flask**: live-data proxy to NBA CDN. Launchd, port 5000.
- **MCP**: Mac MCP at `mac-mcp.schnapp.bet`, FastMCP, 10 tools.

## Where to start

- `/CLAUDE.md` — project identity, session lifecycle, non-negotiables.
- `/docs/README.md` — documentation router.
- `/docs/PRODUCT_BLUEPRINT.md` — sport-agnostic product concept.
- `/docs/CONNECTIONS.md` — single source of truth for external systems and secrets.

This repo is the clean rebuild of the live product. The reference codebase (sports-modeling) stays at `/Users/schnapp/sports-modeling` for intent.
