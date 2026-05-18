# ADR-20260517-2: schnapp-bet structure-and-scaffolding milestone

Date: 2026-05-17

## Context

The sports-modeling repo (`/Users/schnapp/sports-modeling`) is the live production codebase but has accumulated structural smells: a 146 KB monolith `DECISIONS.md`, a 66 KB monolith `CHANGELOG.md`, three-place duplication of session lifecycle (root `CLAUDE.md` + `docs/README.md` + `docs/SESSION_PROTOCOL.md`), an `infrastructure/` directory that is actually one documentation file in disguise, a `memory/` directory holding one historical handoff unused by tooling, a `grading-v2/` directory containing only sprint-tracking docs (zero Python) for a project whose Phases 1–8 are all already merged into `grading/`, and a `docs/skills/` directory conflating Claude skills with feature methodology specs. Root `CLAUDE.md` at ~270 lines is past the ~200 line adherence threshold.

The schnapp-bet repo (`/Users/schnapp/code/schnapp-bet`) was scaffolded with a four-layer Claude Code config already in place — root `CLAUDE.md` at ~75 lines, `LEARNED.md`, `MEMORY.md`, `.claude/{commands,hooks,rules,skills}/`, thin per-component `CLAUDE.md` pointers. Two component CLAUDE.md files (`database/` and `services/flask/`) still carried full content because no rule equivalents existed yet.

User asked for a structure-and-scaffolding rebuild that builds on schnapp-bet's existing scaffold rather than starting over, fixes the inherited smells, and leaves the repo ready for the next milestone (code port) without porting code yet.

## Decision

Ship the 14-step plan documented in `/Users/schnapp/.claude/plans/schnapp-bet-redesign-analysis-misty-babbage.md`. Concretely:

- Refine root `CLAUDE.md` (add 3-line Claude Code vs claude.ai dispatch block, 1-line Windows-host caveat, fix PYTHONPATH path bug). Stay <200 lines.
- Add `.claude/bootstrap-plugins.sh` (port verbatim from sports-modeling) plus `extraKnownMarketplaces` + `enabledPlugins` blocks in `settings.json` declaring 17 plugins. SessionStart matcher `""` wires the bootstrap.
- Add 4 new path-scoped rules: `database.md` (paths: `database/**`), `flask.md` (paths: `services/flask/**`), `workflows.md` (paths: `.github/workflows/**`), `docs.md` (paths: `docs/**`). Each carries the invariants the corresponding sports-modeling docs spread across multiple files.
- Extend `etl.md` with the FanDuel-only line and a line on Python runtime (mac-runner / Mac MCP only).
- Shrink `database/CLAUDE.md` and `services/flask/CLAUDE.md` to thin pointers matching the etl/grading/web/shared pattern.
- Add 5 new skills: `regenerate-bootstrap-sql`, `regenerate-health`, `new-sport-onboarding`, `changelog-rotate`, `live-session-cache` (project override).
- Add `/adr` command for one-step ADR creation with auto-counter math.
- Build `docs/` with: thin `README.md` router, port `PRODUCT_BLUEPRINT.md` (verbatim), `GLOSSARY.md` (verbatim), `CONNECTIONS.md` (strip Azure, re-redact), `ROADMAP.md` (trim hard), `changelog/README.md` + `changelog/2026.md` (per-year rotation), `decisions/README.md` + 10 ported ADRs + 2 new ADRs (this one + the bootstrap-strategy ADR), `features/playoff-supplemental.md` (port from sports-modeling/docs/skills/), `runbooks/{README,deploy-web,runner-and-services,tunnels-and-dns}.md` (split from sports-modeling/infrastructure/README.md).
- Add `.gitignore` (missing).
- Add component README stubs at root, `database/`, `database/{nba,mlb,nfl}/`, `etl/{nba,mlb,nfl}/`.
- Update `MEMORY.md` to "scaffold complete; code port next".

Locked decisions:

| ID | Concern | Choice |
|---|---|---|
| D1 | Bootstrap SQL | Hybrid — see ADR-20260517-1. |
| D2 | CHANGELOG enforcement | Stay advisory. Existing `stop-reminder.sh` nags. |
| D3 | Plugin bootstrap list | All 17 verbatim. Bootstrap is idempotent. |
| D4 | Power Query rule | Drop until needed. |
| D5 | HEALTH.md | Gitignore + always regenerate locally. |
| D6 | claude.ai surface guidance in CLAUDE.md | Add 3 lines. |
| D7 | Windows-host caveat | Add 1 line. |
| D8 | Workflow stale-status lesson location | Stays in CLAUDE.md Non-Negotiables. |
| D9 | ADR port scope | ~10 currently load-bearing, renamed to date convention. Older ADRs stay in sports-modeling. |

Drops (no port from sports-modeling): `grading-v2/`, `infrastructure/`, `memory/`, `docs/skills/`, `docs/SESSION_PROTOCOL.md`, `etl/_shared/`, `etl/_archive/`, top-level `package.json` workspace, top-level vestigial `web/{nba,mlb,nfl}/` dirs, `.github/workflows/claude.yml`, one-shot migration workflows.

Defers (next milestone): all sport-specific code under `etl/`, `grading/`, `web/`; `shared/db.py` and `shared/integrity.py`; `services/flask/runner.py`; `database/<schema>/bootstrap.sql`; `.github/workflows/*.yml`.

## Consequences

- Next milestone (code port) drops into a clean home. Rules auto-load when editing the matching paths; skills are on-demand; hooks enforce the few must-hold invariants.
- Root `CLAUDE.md` stays <200 lines. Detail lives in path-scoped rules.
- Documentation lives in one place per concept. No three-place lifecycle, no 146 KB monolith.
- Generated artifacts (`HEALTH.md`, `bootstrap.sql`) are clearly marked. `HEALTH.md` is gitignored; `bootstrap.sql` is documented as non-idempotent and gated by the regenerate skill.
- `grading-v2/` lessons are captured in ADR-20260423-1, ADR-20260505-1, and this ADR. The sprint-tracking files themselves are not ported.

## Open questions for the next milestone

- When `shared/integrity.py` ports, split CRITICAL_FIELDS / RELATIONAL_CHECKS into per-sport catalogs to remove the NBA bias.
- When `grading/` ports, decide whether `grade_props.py` (currently a single large file in sports-modeling) splits into per-concern modules.
- When `web/` ports, decide which of the 40+ API routes are still needed and which were sprint-tracking experiments.
