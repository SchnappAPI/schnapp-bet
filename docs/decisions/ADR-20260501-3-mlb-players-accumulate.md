# ADR-20260501-3: `mlb.players` accumulate-across-seasons; NFL `get_engine` consolidation

Date: 2026-05-01

## Context

Two problems addressed together.

(D) `mlb.players` was truncate-and-reload scoped to the current season. The first multi-season play-by-play backfill (2026-04-21) loaded 384,040 at-bat rows spanning 2023–2026, exposing a 20–32% NULL name rate when joining `mlb.player_at_bats` and `mlb.career_batter_vs_pitcher` to `mlb.players` at read time. Root cause: ~983 player IDs from 2023–2025 are not on any 2026 roster and therefore absent from the current-season-only player table. The workaround (read-time join instead of denormalized names) was documented as accepted loss pending Initiative D.

(B) `etl/nfl_etl.py` contained a local `get_engine()` definition byte-for-byte identical to the one in `etl/db.py` (`shared/db.py` after the monorepo split). Initiative A established `shared/db.py` as the canonical shared module; the NFL duplicate is inconsistency waiting to diverge.

## Decision

**(D)** Change `mlb.players` from truncate-and-reload to MERGE/accumulate-across-seasons.

- Add `last_seen_season INT NOT NULL DEFAULT 0` column. Migration is an idempotent `IF NOT EXISTS … ALTER TABLE` that runs at ETL startup before `load_players()`.
- Rewrite `load_players()`: iterate seasons in ascending order, use a `dict` keyed by `player_id` (last-season-wins for dedup), add `last_seen_season = season` to each row, then MERGE the whole batch into `mlb.players` with `CASE WHEN src.last_seen_season > tgt.last_seen_season` guard so a nightly single-season pass never clobbers a higher `last_seen_season` already stored.
- Remove `truncate_and_load` call for players; all other tables keep truncate-and-reload semantics.
- Nightly runs (current season only) keep the same API call count. Historical players already in the table are not touched. Backfill runs (2023–current) upsert all seasons in one pass.
- After the first backfill, NULL join rate on `mlb.player_at_bats` and `mlb.career_batter_vs_pitcher` drops to ~0% for seasons 2023+. Pre-2022 data (if ever backfilled) would require an additional player-season load.

**(B)** In `etl/nfl_etl.py`, replace the local `get_engine()` definition with `from shared.db import get_engine`. No behavioral change; the two implementations were identical.

## Consequences

- `mlb.players` row count grows from ~1,000 (current season) to ~3,000–4,000 (all active/recently-active players across 2023–2026). Read-time join cost remains negligible.
- The INVARIANTS section of `database/mlb/README.md` is updated: `mlb.players` write strategy changes from "Truncate + reload" to "MERGE / accumulate".
- `etl/nfl_etl.py` depends on `shared.db`. Any environment that runs it must have `shared/db.py` importable on PYTHONPATH (already true for all GitHub Actions runs).
- The old `load_players()` `seen` set kept the first (lowest season) occurrence; the new dict keeps the last (highest season) occurrence — correct since current-season data is more accurate for team_id and position.
