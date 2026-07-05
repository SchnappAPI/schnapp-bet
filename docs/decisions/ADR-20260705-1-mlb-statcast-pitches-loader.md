# ADR-20260705-1: Phase 5 Savant pitch loader — pybaseball direct, not the Azure Parquet lake

Date: 2026-07-05

## Context

The MLB research dashboard master plan (docs/features/mlb-research-dashboard.md,
Phase 5) reserved a later phase for true Savant enrichment: a
`mlb.statcast_pitches` table carrying the fields the nightly StatsAPI
play-by-play load cannot provide — Savant's modeled xBA/xSLG/xwOBA
(`estimated_*_using_speedangle`), swing/whiff description grain, bat speed,
swing length, and attack angle. It unlocks the "revisit after Phase 5" list
(true xBA replacing the `hit_probability` proxy, Whiff% in BvP, Pitch
Velocity/Player Breakdowns surfaces). The owner green-lit Phase 5 on
2026-07-05 ([PHASE 5 GO]).

The plan assumed the source would be the Azure Parquet lake filled by
`etl/backfill/mlb/backfill_statcast.py` (weekly Parquet per season,
container `mlb-backfill`). That route is dead in practice:

1. No `AZURE_STORAGE_*` credentials exist in the `web-variables` vault (the
   single source of truth for runtime secrets per ADR-20260517-5). The lake
   was written in the sports-modeling era; its credentials were never
   migrated.
2. The lake is stale. The backfill last ran pre-cutover; no workflow has
   appended 2026 weeks. Loading it would still require a Savant re-pull for
   the current season.
3. The lake itself was populated via `pybaseball.statcast()` — Savant is
   the actual source; Azure was only intermediate storage.

## Decision

1. **Pull straight from Savant via pybaseball**, skipping the lake. New
   loader `etl/mlb_statcast_load.py` pulls `statcast(start, end)` in
   date-chunked windows and MERGEs into new table `mlb.statcast_pitches`.
2. **Key = (game_pk, at_bat_number, pitch_number)** — matches the master
   plan; `at_bat_number` is the game-wide PA sequence on both sides, so the
   join to `mlb.player_at_bats` / `mlb.play_by_play` is mechanical.
3. **Column subset, not the full 100+ Savant frame**: keys, date, batter,
   pitcher, pitch_type, release_speed, description, events, launch_speed,
   launch_angle, bat_speed, swing_length, attack_angle,
   estimated_ba_using_speedangle, estimated_slg_using_speedangle,
   estimated_woba_using_speedangle, woba_value, zone. Anything else is a
   re-pull away; a narrow table keeps load fast and the DDL legible.
4. **Coverage starts 2024-03-01** (per the master plan's "2024→"); the
   backfill is chunked per week and idempotent (MERGE), so re-runs converge.
5. **Nightly incremental** rides a new `mlb-statcast-load.yml` workflow
   (mac-runner, 1Password secrets, pipeline-truth heartbeats): default mode
   loads the last 3 days (Savant publishes with up to a day of lag;
   overlapping windows are free under MERGE). `backfill` dispatch input
   loads an explicit start/end range.
6. **DDL owned by the loader** (guarded CREATE), matching the mlb.*
   convention. Table enters CRITICAL_FIELDS via the shared integrity
   catalog like the other mlb.* pitch tables.

## Consequences

- The xBA proxy swap, Whiff% in BvP, and pitcher-breakdown surfaces become
  buildable; they remain separate follow-ups (each touches ETL lockstep
  definitions and needs its own verification).
- Savant rate limits shape the backfill: pybaseball pulls ~week windows
  with a courtesy sleep, so the 2024→ backfill runs ~15-20 min on
  mac-runner. Acceptable for a one-shot.
- The Azure lake (and `backfill_statcast.py`) stays as-is: a cold historical
  archive for 2015-2023 seasons out of current scope. If pre-2024 history is
  ever wanted, restore the storage credential and write a lake reader then.
- `database/mlb/bootstrap.sql` regenerates after the first load.
