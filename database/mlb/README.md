# database/mlb/

**STATUS:** design phase. Schema design carries over from sports-modeling; bootstrap.sql lands in the code-port milestone.

## Planned tables (from sports-modeling)

11 tables per ADR-20260420-2 (pre-aggregated visuals, no runtime DAX):

- `mlb.teams`, `mlb.players` — reference. `mlb.players` is MERGE/accumulate-across-seasons per ADR-20260501-3.
- `mlb.games` — schedule with status, includes today's scheduled games.
- `mlb.batting_stats`, `mlb.pitching_stats`, `mlb.player_season_batting`, `mlb.pitcher_season_stats` — game and season aggregates from MLB Stats API `/withMetrics`.
- `mlb.play_by_play` — pitch-level Statcast data. ETL-internal; not queried by web.
- `mlb.player_at_bats` — derived from PBP, in-lockstep materialization.
- `mlb.career_batter_vs_pitcher` — staged MERGE off `player_at_bats`.
- `mlb.player_trend_stats` — one row per (batter, game_date) per ADR-20260501-1 lineage.

## Invariants

- `mlb.players` is MERGE/accumulate, NOT truncate-and-reload. `last_seen_season` column drives dedup.
- Pitch-level `mlb.play_by_play` is ETL-internal. Web reads only aggregate tables. See `docs/decisions/ADR-20260420-2-mlb-preaggregated-stats.md`.
- `is_hit_into_play = 0` → `hit_launch_speed`, `hit_launch_angle`, `hit_total_distance` are NULL (strikeouts, walks, HBP have no batted ball). Domain-conditional null in `CRITICAL_FIELDS`.
- `batter_id` is NULL on pickoff and caught-stealing events in `play_by_play`.

See `.claude/rules/database.md` for the auto-loaded ruleset.
