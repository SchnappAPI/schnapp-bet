# MLB Database

**STATUS:** in development. 7 tables populated nightly (reference, games, per-game box scores, season snapshots). 1 pitch-level table populated nightly at 09:30 (scheduled 2026-07-03; previously on-demand). 3 derived tables materialized in-lockstep with pitch-level (at-bat grain, career batter-vs-pitcher grain, and rolling trend stats time-series). 2 projection-layer tables (`batter_context`, `batter_projections`) written by the grading workflow — all nine ADR-0004 entities exist. The MLB product itself is in development and not considered fully live.

## Purpose

The `mlb` schema holds the current MLB dataset. Seven tables populate from the nightly ETL, four tables populate from the on-demand play-by-play loader (the pitch-level table, the at-bat derived table, the career batter-vs-pitcher table, and the player trend stats time-series). All DDL for these 11 tables is owned by the two Python ETL scripts — there is no separate `.sql` migration file.

## Files

Live DDL sources (the one-time `mlb_batting_stats_migration.sql` shipped and
was deleted with its workflow on 2026-07-03; see git history if needed):

- `etl/mlb_etl.py` — implicit DDL via pandas `to_sql` for truncate-and-reload tables. Permanent tables' columns are defined by the row dict keys in each loader function
- `etl/mlb_play_by_play.py` — explicit `CREATE TABLE IF NOT EXISTS` and `ALTER COLUMN` statements in `DDL_CREATE`, `DDL_ALTER_DESCRIPTIONS`, `DDL_CREATE_PBP_INDEXES`, `DDL_CREATE_BOXSCORE_INDEXES` (game_pk indexes for the mlb_etl-owned box-score tables), `DDL_CREATE_AT_BATS`, `DDL_DROP_NAME_COLUMNS`, `DDL_CREATE_AT_BATS_INDEXES`, `DDL_CREATE_BVP`, and `DDL_CREATE_BVP_INDEXES`
- `grading/compute_mlb_projections.py` — `IF OBJECT_ID ... CREATE TABLE` DDL for `mlb.batter_context` and `mlb.batter_projections`

## Key Concepts

### Tables that exist today

| Table | Purpose | Primary key | Load strategy |
|-------|---------|-------------|----------------|
| `mlb.teams` | Team reference | `team_id` | Truncate + reload |
| `mlb.players` | Player reference including bat_side and pitch_hand | `player_id` | MERGE / accumulate-across-seasons |
| `mlb.games` | One row per game (Final + today's scheduled) | `game_pk` | Upsert |
| `mlb.batting_stats` | Per-batter per-game box score | `batter_game_id` | Upsert |
| `mlb.pitching_stats` | Per-pitcher per-game box score | `pitcher_game_id` | Upsert |
| `mlb.player_season_batting` | Season cumulative batting snapshot | (no enforced PK; unique on `player_id`) | Truncate + reload |
| `mlb.pitcher_season_stats` | Season cumulative pitching snapshot | (no enforced PK; unique on `player_id`) | Truncate + reload |
| `mlb.play_by_play` | One row per pitch/baserunning event with Statcast metrics | `play_event_id` | Direct INSERT (pre-diffed) |
| `mlb.player_at_bats` | One row per completed at-bat, materialized from PBP | `at_bat_id` | Direct INSERT (pre-diffed, in-lockstep with PBP) |
| `mlb.career_batter_vs_pitcher` | Lifetime counts + rates per `(batter_id, pitcher_id)` | Compound `(batter_id, pitcher_id)` | Staged MERGE (in-lockstep with player_at_bats) |
| `mlb.player_trend_stats` | Rolling window stats time-series at `(batter_id, game_date)` grain | Compound `(batter_id, game_date)` | Staged MERGE (in-lockstep with player_at_bats) |
| `mlb.daily_lineups` | Confirmed/projected lineup slots for today's games | Compound `(game_pk, team_id, player_id)` | Upsert (`mlb_lineup_poll.py`, every 30 min in game window) |

### `mlb.teams`

Columns: `team_id`, `team_abbreviation`, `full_name`, `venue_id`.

### `mlb.players`

Columns: `player_id`, `player_name`, `team_id`, `position`, `bat_side`, `pitch_hand`.

`bat_side` codes: `L` | `R` | `S` (switch). `pitch_hand` codes: `L` | `R`.

No foreign key to `mlb.teams`. Historical box scores retain the team context via `batting_stats.team_id`, so `players.team_id` always reflects the current roster.

### `mlb.games`

One row per regular-season game. Final games plus today's scheduled games (see ADR-0011 below). Columns:

- Identity: `game_pk` (PK), `game_date`, `game_datetime`, `game_type` (`R`), `game_status` (`F` for Final, else MLB status code), `abstract_game_state`, `day_night`, `double_header`, `game_number`, `game_display` (`AWY@HME`), `venue_id`, `venue_name`
- Away team: `away_team_id`, `away_team_score`, `away_is_winner`, `away_pitcher_id`, `away_pitcher_name`, `away_pitcher_hand`
- Home team: `home_team_id`, `home_team_score`, `home_is_winner`, `home_pitcher_id`, `home_pitcher_name`, `home_pitcher_hand`
- Series metadata (currently NULL-filled): `is_tie`, `games_in_series`, `series_game_number`, `game_date_index`

### `mlb.batting_stats`

One row per batter per game. PK: `batter_game_id = '{player_id}-{game_pk}-{team_id}'`. Including `team_id` in the PK preserves trade history — a player who appeared for two teams in the same season has two distinct keys.

Full columns: `batter_game_id`, `game_pk`, `game_date`, `player_id`, `team_id`, `side` (`A`|`H`), `position`, `batting_order`, `games_played`, `plate_appearances`, `at_bats`, `runs`, `hits`, `doubles`, `triples`, `home_runs`, `total_bases`, `rbi`, `stolen_bases`, `walks`, `intentional_walks`, `strikeouts`, `hit_by_pitch`, `left_on_base`, `sac_bunts`, `sac_flies`, `fly_outs`, `ground_outs`, `air_outs`, `pop_outs`, `line_outs`, `batting_avg`, `obp`, `slg`, `ops`.

### `mlb.pitching_stats`

One row per pitcher per game. PK: `pitcher_game_id = '{player_id}-{game_pk}'`. No `team_id` in the PK because a pitcher does not switch teams mid-game.

Columns: `pitcher_game_id`, `game_pk`, `game_date`, `player_id`, `team_id`, `side`, `innings_pitched` (decimal; `.1` = 1/3, `.2` = 2/3), `hits_allowed`, `runs_allowed`, `earned_runs`, `walks`, `strikeouts`, `hr_allowed`, `era`, `pitches`, `strikes`, `note` (`SP` for starting pitcher, else NULL).

### `mlb.player_season_batting`

Full-season snapshot per player. Truncated and reloaded nightly. Columns:

`player_id`, `player_name`, `team_id`, `season_year`, `age`, `games_played`, `at_bats`, `plate_appearances`, `hits`, `doubles`, `triples`, `home_runs`, `runs`, `rbi`, `walks`, `intentional_walks`, `strikeouts`, `hit_by_pitch`, `stolen_bases`, `caught_stealing`, `stolen_base_pct`, `caught_stealing_pct`, `ground_into_double_play`, `total_bases`, `left_on_base`, `sac_bunts`, `sac_flies`, `ground_outs`, `air_outs`, `pitches_seen`, `batting_avg`, `obp`, `slg`, `ops`, `babip`, `ground_outs_to_air_outs`, `at_bats_per_hr`, `catchers_interference`.

### `mlb.pitcher_season_stats`

Full-season snapshot per pitcher. 58 columns. Covers core rate stats (`era`, `whip`, `strike_pct`, `win_pct`), per-9 metrics (`k_per_9`, `bb_per_9`, `h_per_9`, `runs_per_9`, `hr_per_9`), platoon-independent totals (`wins`, `losses`, `saves`, `blown_saves`, `holds`, `complete_games`, `shutouts`, `games_finished`), counts allowed (`hits_allowed`, `hr_allowed`, `walks`, `hit_by_pitch`, `stolen_bases_allowed`), and derived ratios (`strikeout_walk_ratio`, `pitches_per_inning`).

### `mlb.play_by_play`

One row per play event (pitch, pickoff attempt, stolen base) across all Final regular-season games loaded so far. PK: `play_event_id = '{game_pk}-{at_bat_number}-{play_event_index}'`.

Column families:

- Identity: `play_event_id`, `game_pk`, `game_date`, `at_bat_number`, `play_event_index`, `inning`, `is_top_inning`, `team_id`, `vs_team_id`, `away_team_id`, `home_team_id`, `venue_id`
- At-bat result (populated only on the last pitch of the at-bat): `result_event_type`, `result_description`, `result_rbi`, `result_is_out`, `at_bat_is_complete`, `at_bat_is_scoring_play`, `at_bat_has_out`, `at_bat_end_time`, `play_end_time`, `is_at_bat`, `is_plate_appearance`
- Matchup: `batter_id`, `batter_hand_code`, `batter_split`, `pitcher_id`, `pitcher_hand_code`, `pitcher_split`
- Event metadata: `play_id`, `play_event_type`, `is_pitch`, `is_base_running_play`, `pitch_number`, `pitch_call_code`, `pitch_type_code`, `play_event_description`
- Pitch outcome: `is_hit_into_play`, `is_strike`, `is_ball`, `is_out`, `runner_going`, `count_balls_strikes`, `count_outs`, `is_last_pitch`, `play_event_end_time`
- Statcast pitch data: `pitch_start_speed`, `pitch_end_speed`, `pitch_zone`, `strike_zone_top`, `strike_zone_bottom`
- Statcast hit data: `hit_launch_speed`, `hit_launch_angle`, `hit_total_distance`, `hit_trajectory`, `hit_hardness`, `hit_location`, `hit_probability`, `hit_bat_speed`, `home_run_ballparks`
- Audit: `created_at` (defaults to `GETUTCDATE()`)

### `mlb.player_at_bats`

One row per completed at-bat (the first of ADR-0004's derived entities to ship). Materialized from `mlb.play_by_play` using the filter `is_last_pitch = 1 AND result_event_type IS NOT NULL`. PK: `at_bat_id = '{game_pk}-{at_bat_number}'`.

Populated in-lockstep with `mlb.play_by_play` — after each PBP flush, the loader materializes at-bats for the games just written. The diff against existing rows runs against `mlb.player_at_bats.game_pk` (not PBP), so partial runs that landed PBP rows but not at-bat rows self-heal on the next invocation. Rebuild mode (`--rebuild-at-bats` in `mlb_play_by_play.py`) processes every game currently in PBP.

Columns: `at_bat_id`, `game_pk`, `game_date`, `at_bat_number`, `inning`, `is_top_inning`, `batter_id`, `pitcher_id`, `result_event_type`, `result_description`, `result_rbi`, `hit_launch_speed`, `hit_launch_angle`, `hit_total_distance`, `hit_trajectory`, `hit_hardness`, `hit_probability`, `hit_bat_speed`, `home_run_ballparks`, `away_team_id`, `home_team_id`, `created_at`.

IDs only — no denormalized batter or pitcher names. `mlb.players` is truncate-and-reload scoped to the current season, so roughly 30% of historical `pitcher_id`s and 20% of historical `batter_id`s would resolve to NULL if names were joined at write time. Web routes join `mlb.players` at read time instead; the table is under a thousand rows with a PK on `player_id`, so the join cost is negligible.

Indexes: `IX_player_at_bats_game_pk` (per-game web lookup), `IX_player_at_bats_batter` on `(batter_id, game_date)` (future Player Analysis access path).

### `mlb.career_batter_vs_pitcher`

One row per `(batter_id, pitcher_id)` pair with lifetime counts and rates. The second of ADR-0004's derived entities to ship. PK: compound `(batter_id, pitcher_id)` clustered — no synthetic key. Materialized from `mlb.player_at_bats`, not from `mlb.play_by_play` (player_at_bats is already at the right grain and indexed on `batter_id`). See ADR-0019 for the source, grain, and write-strategy decisions.

Populated in-lockstep with `mlb.play_by_play` and `mlb.player_at_bats` — after each PBP flush, `load_player_at_bats_for_games` runs first, then `load_career_bvp_for_games` runs against the same game set. Unlike the other two derived tables, write strategy is **staged MERGE**, not direct INSERT: a `(batter_id, pitcher_id)` pair that appeared in an earlier flush already has a row and needs UPDATE, not INSERT. The materializer stages affected pairs to `#affected_pairs`, joins back to the full `mlb.player_at_bats` to recompute lifetime counts into `#stage_bvp`, and MERGEs into the permanent table. AVG, OBP, SLG, and OPS are computed inside the MERGE and stored pre-computed so web reads require no arithmetic.

Columns:

- Identity: `batter_id`, `pitcher_id` (compound PK)
- Count stats: `plate_appearances`, `at_bats`, `hits`, `singles`, `doubles`, `triples`, `home_runs`, `rbi`, `walks`, `strikeouts`, `hit_by_pitch`, `sac_flies`, `total_bases`
- Rate stats (pre-computed, `DECIMAL(5,3)` or NULL when denominator is zero): `batting_avg`, `obp`, `slg`, `ops`
- Audit: `last_faced_date` (MAX over `player_at_bats.game_date` for the pair), `updated_at` (defaults to `GETUTCDATE()`, set to `SYSUTCDATETIME()` in the MERGE UPDATE branch)

Event-type taxonomy is fixed in `BVP_AGGREGATE_SELECT` (module constant in `mlb_play_by_play.py`):

- Hits: `single`, `double`, `triple`, `home_run`
- Walks: `walk`, `intent_walk`
- Strikeouts: `strikeout`, `strikeout_double_play`
- HBP: `hit_by_pitch`
- Sac flies: `sac_fly`, `sac_fly_double_play`
- AB excludes walks, intent walks, HBP, sac flies, sac bunts (both variants), and `catcher_interf`

Indexes: compound PK on `(batter_id, pitcher_id)` is clustered (covers "this batter vs all pitchers" reads). `IX_bvp_pitcher` on `(pitcher_id, batter_id)` covers the reverse "this pitcher vs all batters" read path.

Rebuild mode: `--rebuild-bvp` in `mlb_play_by_play.py` (or `rebuild_bvp=true` in the workflow) chunks by `batter_id` (200 per chunk) and MERGEs from scratch. Initial backfill from 384,040 at-bat rows produced 165,550 pairs across 806 batters in approximately 6 seconds.

### `mlb.player_trend_stats`

One row per `(batter_id, game_date)`. Each row represents rolling stats *entering* that game (game_date exclusive). PK: compound `(batter_id, game_date)` clustered. See ADR-20260501-1 for the time-series vs. current-state design decision.

Three rolling windows (L10, L30, L60), each with 13 metric columns:

- `w{N}_pa`, `w{N}_ab`, `w{N}_hits`, `w{N}_hit_rate`, `w{N}_bb_rate`, `w{N}_k_rate` — plate discipline
- `w{N}_total_bases`, `w{N}_tb_per_pa`, `w{N}_home_runs` — power
- `w{N}_avg_ev`, `w{N}_hard_hit_pct`, `w{N}_barrel_pct`, `w{N}_avg_xba` — Statcast quality

Platoon splits (full history, not windowed — more stable at low PA): `vs_lhp_pa`, `vs_lhp_hits`, `vs_lhp_hit_rate`, `vs_rhp_pa`, `vs_rhp_hits`, `vs_rhp_hit_rate`. Pitcher hand comes from joining `mlb.play_by_play` on `(game_pk, at_bat_number, is_last_pitch=1)`.

Home/away splits (full history): `home_pa`, `home_hits`, `home_hit_rate`, `away_pa`, `away_hits`, `away_hit_rate`. Home/away determined by `is_top_inning` (0 = home batter).

Indexed by `IX_trend_stats_date` on `(game_date, batter_id)` for date-range reads.

DDL owned by `mlb_play_by_play.py` (`DDL_CREATE_TREND_STATS`, `DDL_CREATE_TREND_STATS_INDEXES`). Rebuild mode: `--rebuild-trend-stats` flag chunks by batter_id (50 per chunk; lighter per-row computation than BvP rebuild's 200).

### ADR-0004 entity status

All nine ADR-0004 entities now exist. The final two shipped 2026-07-03:

- `mlb.batter_context` — one row per (game_date, game_pk, batter_id): side,
  opposing probable SP + hand, venue, day/night, recent batting-order slot,
  and `lineup_confirmed` (1 when boxscore lineup rows exist; 0 when the pool
  is projected from recent appearances). No weather yet — no weather source
  is ingested; add a column + source when one is.
- `mlb.batter_projections` — one row per (game_date, game_pk, batter_id,
  market_key): deterministic `proj-v1.0` projected value + 0-1 confidence.
  Written by `grading/compute_mlb_projections.py` as a step in
  `mlb-grading.yml` before grading; idempotent per (game_date, game_pk).

Player at-bats shipped 2026-04-21. Career BvP shipped 2026-04-21. Player trend stats (combining rolling windows and platoon splits in a single time-series table) shipped 2026-05-01.

## Invariants

- `batter_game_id` includes `team_id` so mid-season trades create distinct rows. Do not change the PK format
- `pitcher_game_id` does **not** include `team_id` because pitchers do not switch teams mid-game
- `mlb.games` stores both Final games and today's scheduled (non-Final) games. The web strip depends on this
- Game PK is MLB's `game_pk` integer, not a synthetic key
- `mlb.play_by_play` result-related columns are NULL on all pitches except the last one of an at-bat (`is_last_pitch = 1`). Queries that need at-bat results must filter on that predicate
- Pitch-level Statcast stays internal to the ETL layer. Web reads only aggregate views of `mlb.play_by_play` (linescore) or the materialized `mlb.player_at_bats` / `mlb.career_batter_vs_pitcher`, never raw pitch rows
- `mlb.players` is **accumulate-across-seasons** (MERGE, not truncate-and-reload). Nightly runs add/update the current season; backfill runs cover 2023–current. `last_seen_season INT` column tracks the most recent season each player appeared in. NULL join rate on `mlb.player_at_bats` / `mlb.career_batter_vs_pitcher` is ~0% for seasons 2023+. See ADR-20260501-3
- `mlb.player_at_bats` stores `batter_id` and `pitcher_id` only, never denormalized names. Names are joined from `mlb.players` at read time (accumulative table; historical players are retained)
- `mlb.player_at_bats` has `at_bat_id = '{game_pk}-{at_bat_number}'` as PK. Do not change this format
- Materialization of `mlb.player_at_bats` runs in-lockstep with `mlb.play_by_play` writes. The at-bats diff runs separately against `mlb.player_at_bats` so partial runs self-heal
- `mlb.career_batter_vs_pitcher` uses compound `(batter_id, pitcher_id)` PK, not a synthetic string key. Do not change this — queries filter naturally on one or both IDs
- `mlb.career_batter_vs_pitcher` materialization source is `mlb.player_at_bats`, never `mlb.play_by_play` directly. The derived-to-derived dependency is deliberate (at-bats runs first within the same flush cycle)
- Rate stats on `mlb.career_batter_vs_pitcher` (`batting_avg`, `obp`, `slg`, `ops`) are stored pre-computed, not derived at read time. A bug in the ratio math requires a full rebuild via `--rebuild-bvp` after DELETE. Do not add a view layer that recomputes them
- `mlb.player_trend_stats` is a time-series: `(batter_id, game_date)` PK, one row per player per game played. game_date is exclusive — each row reflects stats entering that game, not after. Do not change to a single current-state row; the time-series grain is required for historical grading backtest
- `mlb.player_trend_stats` platoon splits (`vs_lhp_*`, `vs_rhp_*`) span full career history (not windowed). Rolling window columns (`w10_*`, `w30_*`, `w60_*`) are game-count windows (not at-bat counts). Do not change either of these without a superseding ADR
- `mlb.player_trend_stats` materialization runs in-lockstep after `mlb.player_at_bats` in the same PBP flush cycle. Source is `mlb.player_at_bats` for most columns; pitcher hand for platoon splits comes from `mlb.play_by_play` via join at write time

## Recent Changes

Git log is the changelog (ADR-20260517-4): `git log --grep='\[mlb\]' --grep='\[database\]'`.

## Open Questions

- Whether the remaining ADR-0004 entities (batter context per game, batter projections, player trend/pattern stats, player platoon splits) should be materialized as tables (pre-aggregated, keeps the runtime-no-aggregation invariant) or computed as SQL views (simpler, but violates ADR-0004)
- Whether player trend/pattern stats and player platoon splits share a table or stay separate — structurally they are related (both roll up across a window of games with a split dimension), but the consumer pages may need different shapes
- Whether the historical Statcast Parquet data (`schnappmlbdata`, ~4.17 GB, 2015-2026) should be ingested into `mlb.play_by_play` as a backfill, kept parallel for historical-only queries, or dropped once the nightly PBP ETL catches up. If ingested, `mlb.career_batter_vs_pitcher` row counts grow correspondingly (more historical matchups surface)
- Whether to add FK constraints across the 7 reference tables or leave them off. They were deliberately dropped when `teams` and `players` became truncate-reload, and re-adding them would require a different load strategy
- Whether `mlb.career_batter_vs_pitcher` should gain recent-window columns (last-3, last-5 matchup stats) or keep rows pure-lifetime with windowed data living in a separate materialized table. Current choice is pure lifetime
