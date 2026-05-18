# etl/nba/

**STATUS:** design phase in schnapp-bet (live in sports-modeling). ETL scripts land here in the code-port milestone.

## Planned scripts (carry over from sports-modeling)

All scripts at `etl/` root per ADR-20260420-1 (flat layout):

- `etl/nba_etl.py` — nightly: teams, players, schedule, box scores (5 calls per period), PT stats (passing + rebounding), daily lineups. Triggered by `.github/workflows/nba-etl.yml` at 09:00 UTC.
- `etl/nba_live.py` — intra-day. Refreshes schedule status and verifies live box scores from the CDN. Does NOT write live rows to DB.
- `etl/lineup_poll.py` — two-stage lineup polling. Stage 1 official JSON (starters), Stage 2 `boxscorepreviewv3` (full roster). Stage 2 always runs (no retry, 20s timeout per ADR-0008 lineage).
- `etl/odds_etl.py` — odds ingestion. FanDuel-only per ADR-20260420-3.

## Data sources

- **stats.nba.com** — requires Webshare rotating residential proxy from GitHub Actions IPs (`NBA_PROXY_URL` secret). Endpoints: `commonallplayers`, `scheduleleaguev2`, `playergamelogs`, `boxscoretraditionalv3`.
- **stats.nba.com / leaguedashptstats** — public, no proxy.
- **cdn.nba.com** — public, no auth. Used for live scoreboard + box scores via Flask.

## Grading pipeline (downstream)

Order of operations across workflows:
1. `nba-etl.yml` (09:00 UTC) — nightly ETL.
2. `odds-etl.yml` (10:00 UTC) — odds ingestion. Triggers `grading.yml` via `workflow_run`.
3. `grading.yml` (11:00 UTC) — `grade_props.py --mode upcoming`. Then intraday, then outcomes.
4. `nba-game-day.yml` (09:30 + */15 00-06 UTC + */15 22-23 UTC) — intra-day cycle.
5. `compute-patterns.yml` (07:30 UTC) — `etl/compute_patterns.py` updates `common.player_line_patterns`.
6. `weekly-calibration.yml` (Sun 06:00 UTC) — `grading/weekly_calibration.py` refits logistic models and rewrites `common.grade_weights`. Sole writer of that table.

## Invariants

- Use `shared.db.get_engine()`; never define a local engine factory.
- `validate_and_filter` at every write to a `CRITICAL_FIELDS` table.
- Incremental ingestion: query destination for what is loaded, compute delta in Python, then call the API.
- `record_workflow_run()` is the last call in upcoming/intraday/outcomes modes. Skip in backfill mode.
- Period column is VARCHAR(2): never insert longer than `'OT'`.

See `.claude/rules/etl.md` and `.claude/rules/grading.md` — both auto-load when editing files under `etl/` or `grading/`.

## Open questions (carried over from sports-modeling)

- NBA lineup backfill for completed games (rewrite `daily_lineups` from official JSON for `game_status = 3`).
- Minutes-prior / rotation-role identification (use season-level mean minutes when not starting, grouped by team).
- Availability / minutes gating in tier-line generation.
- Three-point calibration improvements (discrete low-count distribution is harder than pts/reb/ast).
