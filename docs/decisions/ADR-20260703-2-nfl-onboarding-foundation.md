# ADR-20260703-2: NFL onboarding — foundation now, grading at first odds

Date: 2026-07-03

## Context

NFL had 1 of the 8 onboarding layers (ETL + odds market definitions) and was
failing weekly: `current_nfl_season()` flipped to the new season in June but
nflverse publishes season assets around the opener, so every run since
2026-06-02 404'd. Odds name-mapping printed "not yet implemented", no
`nfl.*` table had integrity coverage, and the web surface was a ComingSoon
stub absent from the nav. It is July (offseason); the season starts in
September, and NFL odds cannot flow until the Odds API key is restored.

## Decision

1. **Season derivation follows nflverse publication**: flip in September
   (`month >= 9`); "season not yet published" (ValueError / release 404) is a
   logged SKIP, not a failure, so the Tuesday cron stays green in offseason
   and picks up new data automatically.
2. **gsis ids ride player_map without a schema break**: `odds.player_map`
   gains a nullable `gsis_id VARCHAR(12)` column (idempotent ALTER in
   `odds_etl.ensure_schema`). Because `player_map.player_id` is BIGINT and
   the integrity catalog requires it on matched rows, NFL rows also store the
   numeric gsis tail there (`00-0033873` → 33873; reversible via
   `f"00-{n:07d}"`). Joins use `gsis_id`; `player_id` exists for catalog
   compatibility only.
3. **Integrity now, not later**: `nfl.games`, `nfl.players`,
   `nfl.player_game_stats` enter `CRITICAL_FIELDS`; `nfl_games_stale` (weekly
   grain, September-aware) and `nfl_player_count_sanity` enter
   `RELATIONAL_CHECKS`; `nfl_etl.upsert` routes catalog tables through
   `validate_and_filter`.
4. **Web foundation ships behind the existing `sport.nfl` flag**: nested
   `/api/nfl/*` routes (NBA convention, not flat `nfl-*`), a week-picker page
   (weekly grain, playoff types WC/DIV/CON/SB collapsed to `POST` to match
   `player_game_stats.season_type`), Sidebar + command-palette entries.
5. **Grading is deferred to first live NFL odds (~September), by design.**
   `nfl_grade_props.py` will follow the MLB `MARKET_CONFIG` family pattern
   with these NFL-specific commitments: weekly keys
   (`season, week, season_type`) instead of dates; settlement stats from
   `nfl.player_game_stats` by `player_gsis_id`; `player_anytime_td`,
   `player_1st_td`, `player_last_td` registered as binary markets in
   `shared/integrity.py`'s `_BINARY_PLAYER_MARKETS`; `MODEL_VERSION =
   "nfl-v1.0"`; a new `nfl-grading.yml` on the weekly cadence. Building it
   now against 2025 odds would ship unverifiable code.

## Consequences

- NFL is one step (grading) from full parity, and that step has a written
  contract instead of an empty stub.
- The gsis-tail-in-BIGINT encoding is a deliberate wrinkle; if a second
  string-keyed sport arrives, migrate `player_map` to a string player key in
  a numbered migration and drop the encoding.
- `event_game_map.home_tricode` is CHAR(3); 2-char NFL codes (KC, GB, LA...)
  are space-padded in storage — consumers must RTRIM or compare via
  `nfl.games` values, which the mapping code already does.
