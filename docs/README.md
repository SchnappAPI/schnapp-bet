# docs/

Documentation router. Session lifecycle (read/write protocols) lives in root `/CLAUDE.md` only — do not duplicate it here.

## What lives where

- `/CLAUDE.md` — project identity, session lifecycle, non-negotiables.
- `/MEMORY.md` — current focus, active items, next-up. Read at session start.
- `/LEARNED.md` — append-only correction log. Read at session start.
- `/docs/PRODUCT_BLUEPRINT.md` — sport-agnostic product concept. Read before any cross-sport or new-sport work.
- `/docs/GLOSSARY.md` — domain vocabulary. Cross-sport terms first, then per-sport sections.
- `/docs/CONNECTIONS.md` — single source of truth for external systems and secrets.
- `/docs/ROADMAP.md` — active priorities. Brief by design.
- `/docs/HEALTH.md` — git-ignored; regenerate locally with `/skill regenerate-health`.
- `/docs/decisions/ADR-YYYYMMDD-N-slug.md` — ADRs, one per file. See `docs/decisions/README.md` for format. The commit log is the changelog (ADR-20260517-4); see root `CLAUDE.md` "Commit subject format" for filtering commands.
- `/docs/features/` — feature methodology specs (not Claude skills). Currently: `playoff-supplemental.md`; `mlb-research-dashboard.md` (+ `mlb-research-dashboard-remainder.md`) — the PBI-port build plan; `mlb-power-bi-catalog.md` — the reverse-engineering source record for that port.
- `/docs/runbooks/` — operational procedures. `deploy-web.md`, `runner-and-services.md`, `tunnels-and-dns.md`.
- `/docs/reviews/` — point-in-time repo audits with prioritized backlog. Newest first; the backlog sections stay live until superseded by a newer review.

## Per-component READMEs

- `web/README.md` — Next.js app structure and conventions.
- `etl/README.md` (and `etl/{nba,mlb,nfl}/README.md`) — ETL design per sport.
- `grading/README.md` — grading engine entry points.
- `database/README.md` (and `database/{nba,mlb,nfl}/README.md`) — schema notes per sport.
- `shared/README.md` — db + integrity infrastructure.
- `services/flask/README.md` — live-data Flask runner.

## Rules

Rules live in `.claude/rules/<scope>.md` and auto-load when editing matching paths. The mapping:

- `etl.md` — editing `etl/**/*.py` or matching workflow YAMLs.
- `grading.md` — editing `grading/**` or grading workflow YAMLs.
- `shared.md` — editing `shared/**/*.py`.
- `web.md` — editing `web/**/*.{ts,tsx,json,css}`.
- `database.md` — editing `database/**`.
- `flask.md` — editing `services/flask/**`.
- `workflows.md` — editing `.github/workflows/**`.
- `docs.md` — editing `docs/**`.
