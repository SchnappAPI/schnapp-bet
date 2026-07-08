# MLB Data Dictionary

Field-level dictionary for the MLB data model. Derived from the source catalog
[`mlb-power-bi-catalog.md`](./mlb-power-bi-catalog.md) (the spine — what fields exist and
what they mean) and enriched with the concrete types, sample values, and semantics from a
2026-era audit of the original `mlb_sample.xlsx` workbook.

## How to read this, and what's authoritative

- **Spine = the catalog.** Every table and field here traces to the catalog's model
  tables, stat tables, or nine consolidated data entities.
- **Field detail = the xlsx audit.** SQL types, nullability, sample values, and the
  normalization notes come from the audit. Its _infrastructure_ context is **stale** — it
  predates the Azure→SQL Server 2022 cutover, proposes `IDENTITY` keys and some table
  names that were never adopted, and describes an Excel-backed model. Those Azure-era
  specifics have been dropped here; the _fields and figures_ still align.
- **Physical ground truth = `database/mlb/bootstrap.sql`.** Where this dictionary and the
  live DDL disagree on a column name or type, the DDL wins. This file is a semantic
  reference, not a schema dump.
- **Two layers.** _Raw ingest_ tables are near-direct API/Statcast pulls. _Derived_
  tables are computed by the Python ETL because Power BI computed them at report time —
  see the catalog's "pre-computation gap" and [ADR-20260420-2](../decisions/ADR-20260420-2-mlb-preaggregated-stats.md).
- **Type convention.** Raw-table types are the audit's. Derived-table types are by
  analogy to their raw source columns (marked per section) — treat them as suggested.

## Cross-cutting normalization rules

These ETL transforms apply across tables and are the main reason the raw API/xlsx shapes
differ from the stored columns:

| Rule                    | Detail                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'TBD'` → `NULL`        | `away_pitcher_hand` / `home_pitcher_hand` carry the string `'TBD'` before a start is confirmed. Normalize to `NULL`.                                                                                        |
| `'.---'` → `NULL`       | Stolen-base-percentage columns store `'.---'` for zero attempts. Parse to `NULL`.                                                                                                                           |
| Batting order ×100      | `batting_order` is stored as lineup spot × 100 (100 = leadoff … 900 = 9th). Divide by 100 for display.                                                                                                      |
| Number-prefixed renames | Source columns `1B`, `2B`, `3B`, `K%`, `BB%`, `Whiff%`, `HH%` are invalid SQL identifiers — renamed to `singles`, `doubles`, `triples`, `k_pct`, etc.                                                       |
| Name format             | Names are `"Last, First"` in the Statcast feed but `"First Last"` everywhere else. Standardize to `"First Last"`.                                                                                           |
| Fractional innings      | `innings_pitched` uses MLB notation: `.1` = 1 out, `.2` = 2 outs (so `6.2` = 6⅔ IP, not 6.2).                                                                                                               |
| `HRR` ambiguity         | The raw per-game `HRR` was flagged ambiguous in the audit (running count vs rate). In the report it reads as a home-run rate; confirm against the Power Query / ETL logic before relying on the raw column. |
| Season identity         | Season stat tables carry no season field in the source — the ETL adds `season_year` so multiple seasons coexist.                                                                                            |

---

# Layer 1 — Reference & raw ingest tables

Near-direct pulls from the MLB Stats API (`statsapi.mlb.com`) and Baseball Savant. Types
and nullability are the audit's.

## `mlb.teams` — team reference

One row per franchise. Catalog: **TEAM**. Source: Stats API. Upsert key: `team_id`.

| field             | type         | null | notes                                                                     |
| ----------------- | ------------ | ---- | ------------------------------------------------------------------------- |
| team_id           | int          | no   | natural MLB API id (PK)                                                   |
| team_abbreviation | varchar(10)  | no   | source field is `team_name` but holds the abbreviation only (`LAA`, `AZ`) |
| full_name         | varchar(100) | yes  | not in source; add from the Stats API                                     |
| venue_id          | int          | yes  | home venue (also denormalized onto `mlb.games`)                           |
| ballpark_pal_team | varchar(10)  | yes  | alternate abbreviation for the BallparkPal source — note `AZ` → `ARI`     |

## `mlb.players` — player reference

One row per player on a roster. Catalog: **PLAYER**. Source: `/sports/1/players`. Upsert
key: `player_id`.

| field       | type         | null | notes                                   |
| ----------- | ------------ | ---- | --------------------------------------- |
| player_id   | int          | no   | natural MLB API id (PK)                 |
| player_name | varchar(100) | no   | display name, `"First Last"`            |
| team_id     | int          | yes  | FK → teams; nullable (free agents / IL) |
| position    | varchar(10)  | yes  | source `POS`; `'P'` covers all pitchers |
| bat_side    | char(1)      | yes  | `R` / `L` / `S` (switch — not a typo)   |
| pitch_hand  | char(1)      | yes  | `NULL` for non-pitchers                 |

## `mlb.games` — one row per game

Catalog: **GAME** (and the **Upcoming games** entity, which is the subset that is not yet
final). Source: `/schedule` + `/game/{id}/withMetrics`. `VENUE` is denormalized onto this
table (`venue_id`, `venue_name`) rather than a separate table. Upsert key: `game_pk`.

| field               | type         | null | notes                                                                      |
| ------------------- | ------------ | ---- | -------------------------------------------------------------------------- |
| game_pk             | int          | no   | natural MLB API id (PK)                                                    |
| game_date           | date         | no   | date only                                                                  |
| game_datetime       | datetime2    | yes  | UTC first pitch                                                            |
| official_date       | date         | yes  | reschedule-aware official date; may differ from `game_date` for late games |
| game_type           | char(1)      | no   | `R` regular / `P` postseason / `S` spring                                  |
| game_status         | varchar(5)   | yes  | short code, e.g. `F` = Final                                               |
| abstract_game_state | varchar(20)  | yes  | verbose status (`Final`)                                                   |
| detailed_state      | varchar(50)  | yes  | most verbose — distinguishes postponed / suspended                         |
| day_night           | varchar(10)  | yes  | `day` / `night`                                                            |
| double_header       | char(1)      | yes  | `N` / `Y`                                                                  |
| game_number         | tinyint      | yes  | 1 or 2 for doubleheaders                                                   |
| game_display        | varchar(20)  | yes  | `AWAY@HOME` (`-2` suffix for game 2)                                       |
| venue_id            | int          | yes  | denormalized venue                                                         |
| venue_name          | varchar(100) | yes  | denormalized venue                                                         |
| away_team_id        | int          | no   | FK → teams                                                                 |
| away_team_score     | tinyint      | yes  | `NULL` until final                                                         |
| away_is_winner      | bit          | yes  | `NULL` until final                                                         |
| away_pitcher_id     | int          | yes  | probable/actual SP, FK → players                                           |
| away_pitcher_name   | varchar(100) | yes  | denormalized                                                               |
| away_pitcher_hand   | char(1)      | yes  | `'TBD'` in source before lineup lock → `NULL`                              |
| home_team_id        | int          | no   | FK → teams                                                                 |
| home_team_score     | tinyint      | yes  | `NULL` until final                                                         |
| home_is_winner      | bit          | yes  | `NULL` until final                                                         |
| home_pitcher_id     | int          | yes  | FK → players                                                               |
| home_pitcher_name   | varchar(100) | yes  | denormalized                                                               |
| home_pitcher_hand   | char(1)      | yes  | `'TBD'` → `NULL`                                                           |
| is_tie              | bit          | yes  |                                                                            |
| games_in_series     | tinyint      | yes  |                                                                            |
| series_game_number  | tinyint      | yes  | which game of the series                                                   |
| game_date_index     | smallint     | yes  | sequential index within a date                                             |

> **`TEAMGAME` (logical, not a physical table).** The catalog's team-perspective view (two
> rows per game: composite key `team_abbreviation-game_pk`, plus `side`, this team's
> pitcher/score/winner and the `vs_*` opponent mirror, and `team_game_index`) is fully
> derivable from `mlb.games` and was **not** built as a stored table (the audit's proposed
> `mlb.team_game_stats` was not adopted). It survives as a query/slicer concept
> (`TEAMGAME.game_date`).

## `mlb.daily_lineups` — confirmed lineups (intraday)

One row per player per game in a captured lineup. Facts only — projected lineups are
derived at read time ([ADR-20260704-1](../decisions/ADR-20260704-1-mlb-lineup-poller.md)).
Populated by the intraday lineup poller.

| field         | type     | null | notes                  |
| ------------- | -------- | ---- | ---------------------- |
| game_pk       | int      | no   | FK → games             |
| team_id       | int      | no   | FK → teams             |
| player_id     | int      | no   | FK → players           |
| batting_order | smallint | yes  | lineup spot × 100      |
| is_confirmed  | bit      | yes  | confirmed vs projected |

## `mlb.batting_stats` — batter box score, per game

One row per batter per game. Catalog: **Box Score Hitting — Game**. Source:
`/withMetrics` `stats.batting`. Upsert key: `batter_game_id` (`player_id-game_pk`).

| field             | type         | null | notes                                                                                                                                                   |
| ----------------- | ------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| batter_game_id    | varchar(30)  | no   | composite `player_id-game_pk` (PK). Note the source `batterGameId` embeds team, so a (game, player) can produce two rows for a mid-game trade edge case |
| game_pk           | int          | no   | FK → games                                                                                                                                              |
| game_date         | date         | no   |                                                                                                                                                         |
| player_id         | int          | no   | FK → players                                                                                                                                            |
| team_id           | int          | no   | FK → teams                                                                                                                                              |
| side              | char(1)      | yes  | `A` / `H`                                                                                                                                               |
| position          | varchar(10)  | yes  | position played this game                                                                                                                               |
| batting_order     | smallint     | yes  | lineup spot × 100                                                                                                                                       |
| plate_appearances | smallint     | yes  | `PA`                                                                                                                                                    |
| at_bats           | smallint     | yes  | `AB`                                                                                                                                                    |
| hits              | smallint     | yes  | `H`                                                                                                                                                     |
| doubles           | smallint     | yes  | source `2B`                                                                                                                                             |
| triples           | smallint     | yes  | source `3B`                                                                                                                                             |
| home_runs         | smallint     | yes  | `HR`                                                                                                                                                    |
| total_bases       | smallint     | yes  | `TB`                                                                                                                                                    |
| extra_base_hits   | smallint     | yes  | `XBH` = 2B + 3B + HR                                                                                                                                    |
| hr_rate           | decimal(6,3) | yes  | source `HRR` — see `HRR` ambiguity note above                                                                                                           |
| strikeouts        | smallint     | yes  | `SO`                                                                                                                                                    |
| walks             | smallint     | yes  | `BB`                                                                                                                                                    |
| intentional_walks | smallint     | yes  | `intBB`                                                                                                                                                 |
| hit_by_pitch      | smallint     | yes  | `HBP`                                                                                                                                                   |
| runs              | smallint     | yes  | `R`                                                                                                                                                     |
| rbi               | smallint     | yes  | `RBI`                                                                                                                                                   |
| stolen_bases      | smallint     | yes  | `SB`                                                                                                                                                    |
| left_on_base      | smallint     | yes  |                                                                                                                                                         |
| sac_bunts         | smallint     | yes  |                                                                                                                                                         |
| sac_flies         | smallint     | yes  |                                                                                                                                                         |

## `mlb.pitching_stats` — pitcher box score, per game

One row per pitcher per game. Catalog: **Box Score Pitching — Game**. Source:
`/withMetrics` `stats.pitching`. (No dedicated audit sheet; fields per the catalog.)
Analogous grain/key to `batting_stats` (`player_id-game_pk`).

Fields: `games_pitched, batters_faced, at_bats, hits, doubles, triples, home_runs,
strikeouts, walks, runs, rbi, intentional_walks, hit_by_pitch, stolen_bases, sac_bunts,
sac_flies, fly_outs, ground_outs, air_outs, pop_outs, line_outs, games_started,
games_finished, complete_games, shutouts, number_of_pitches, innings_pitched, wins,
losses, saves, save_opportunities, holds, blown_saves, earned_runs, outs, balls, strikes,
strike_percentage, hit_batsmen, balks, wild_pitches, passed_ball, runs_scored_per9,
home_runs_per9, inherited_runners, inherited_runners_scored`. Counting stats `smallint`,
pitch/out totals `int`, rates `decimal`, `innings_pitched` `decimal(5,1)` (fractional).

## `mlb.player_season_batting` — cumulative season batting

One row per player per season. Catalog: **Box Score Hitting — Season**. Source:
`/withMetrics` `seasonStats.batting`. Upsert key: `player_id + season_year`.

| field                          | type         | null | notes                           |
| ------------------------------ | ------------ | ---- | ------------------------------- |
| player_id                      | int          | no   | FK → players                    |
| season_year                    | smallint     | no   | added by ETL (absent in source) |
| team_id                        | int          | no   | FK → teams                      |
| age                            | tinyint      | yes  |                                 |
| games_played                   | smallint     | yes  |                                 |
| at_bats                        | smallint     | yes  |                                 |
| plate_appearances              | smallint     | yes  |                                 |
| hits                           | smallint     | yes  |                                 |
| doubles / triples / home_runs  | smallint     | yes  |                                 |
| runs / rbi                     | smallint     | yes  |                                 |
| walks                          | smallint     | yes  | source `baseOnBalls`            |
| intentional_walks              | smallint     | yes  |                                 |
| strikeouts                     | smallint     | yes  | source `strikeOuts` (capital O) |
| hit_by_pitch                   | smallint     | yes  |                                 |
| stolen_bases / caught_stealing | smallint     | yes  |                                 |
| stolen_base_pct                | decimal(5,3) | yes  |                                 |
| caught_stealing_pct            | decimal(5,3) | yes  | source `'.---'` → `NULL`        |
| ground_into_double_play        | smallint     | yes  |                                 |
| total_bases                    | smallint     | yes  |                                 |
| left_on_base                   | smallint     | yes  |                                 |
| sac_bunts / sac_flies          | smallint     | yes  |                                 |
| ground_outs / air_outs         | smallint     | yes  |                                 |
| pitches_seen                   | int          | yes  | source `numberOfPitches`        |
| batting_avg                    | decimal(5,3) | yes  |                                 |
| obp / slg / ops                | decimal(5,3) | yes  |                                 |
| babip                          | decimal(5,3) | yes  |                                 |
| ground_outs_to_air_outs        | decimal(5,2) | yes  |                                 |
| at_bats_per_hr                 | decimal(6,2) | yes  | `NULL` for 0 HR                 |
| catchers_interference          | smallint     | yes  |                                 |

## `mlb.pitcher_season_stats` — cumulative season pitching

One row per pitcher per season. Catalog: **Box Score Pitching — Season** (and the
**Pitcher season stats** entity feeding the opposing-SP visuals). Source: `/withMetrics`
`seasonStats.pitching`. Upsert key: `player_id + season_year`.

Identity & context: `player_id` (FK), `team_id` (FK), `season_year` (ETL-added), `age`.

Counting / volume (`smallint`, pitch & out totals `int`): `games_played, games_started,
games_finished, complete_games, shutouts, wins, losses, saves, save_opportunities, holds,
blown_saves, batters_faced, at_bats_faced, total_pitches, strikes_thrown, outs_recorded,
hits_allowed, doubles_allowed, triples_allowed, hr_allowed, runs_allowed, earned_runs,
walks, intentional_walks, strikeouts, hit_by_pitch, wild_pitches, balks, pickoffs,
stolen_bases_allowed, caught_stealing, ground_outs, air_outs, ground_into_double_play,
total_bases_allowed, inherited_runners, inherited_runners_scored, catchers_interference,
sac_bunts, sac_flies`.

Rates (`decimal`): `era, whip, batting_avg_against, obp_against, slg_against, ops_against,
strike_pct, k_per_9, bb_per_9, h_per_9, hr_per_9, r_per_9, k_bb_ratio, win_pct,
pitches_per_inning, ground_outs_to_air_outs`.

Special: `innings_pitched` `decimal(5,1)` — fractional (see rule above);
`caught_stealing_pct` — `'.---'` → `NULL`.

## `mlb.statcast_pitches` — pitch-by-pitch (Savant)

One row per pitch — the most granular table. Catalog: **Statcast Pitch-Level**. Source:
Baseball Savant `/statcast_search` (loaded via `etl/mlb_statcast_load.py`,
[ADR-20260705-1](../decisions/ADR-20260705-1-mlb-statcast-pitches-loader.md)). Upsert key:
`play_id` (Statcast UUID).

| field                                                        | type         | null | notes                                                      |
| ------------------------------------------------------------ | ------------ | ---- | ---------------------------------------------------------- |
| play_id                                                      | varchar(50)  | no   | Statcast UUID (PK)                                         |
| game_pk                                                      | int          | no   | FK → games                                                 |
| game_date                                                    | date         | no   |                                                            |
| inning                                                       | tinyint      | yes  |                                                            |
| inning_half                                                  | varchar(5)   | yes  | `Top` / `Bot`                                              |
| at_bat_number                                                | smallint     | yes  | game-wide sequential AB number                             |
| pitch_number                                                 | tinyint      | yes  | within the at-bat                                          |
| outs                                                         | tinyint      | yes  | outs at start of pitch                                     |
| balls / strikes                                              | tinyint      | yes  | count before the pitch                                     |
| batter_id                                                    | int          | yes  | FK → players (source `batter`)                             |
| batter_hand                                                  | char(1)      | yes  | `stand` — handedness this AB                               |
| pitcher_id                                                   | int          | yes  | FK → players (source `pitcher`)                            |
| pitcher_hand                                                 | char(1)      | yes  | `p_throws`                                                 |
| team_batting / team_pitching                                 | varchar(10)  | yes  | abbreviations                                              |
| pitch_type                                                   | varchar(5)   | yes  | code (`FF`, `SL`, `KC`…)                                   |
| pitch_name                                                   | varchar(30)  | yes  | `4-Seam Fastball`…                                         |
| release_speed                                                | decimal(5,1) | yes  | mph                                                        |
| zone                                                         | tinyint      | yes  | Statcast zone 1–14                                         |
| pitch_result                                                 | char(1)      | yes  | source `type`: `S` strike / `B` ball / `X` in play         |
| event_type                                                   | varchar(50)  | yes  | pitch result code (`swinging_strike`, `foul`…)             |
| events                                                       | varchar(50)  | yes  | at-bat outcome — only on the last pitch                    |
| description                                                  | varchar(500) | yes  | play description text                                      |
| is_pitch                                                     | bit          | yes  | `False` for pickoffs etc.                                  |
| is_last_pitch                                                | bit          | yes  | last pitch of the AB — result fields attach here           |
| is_take / is_swing / is_whiff / is_foul                      | bit          | yes  | swing decision flags                                       |
| is_pa / is_ab                                                | bit          | yes  |                                                            |
| is_hit_into_play                                             | bit          | yes  |                                                            |
| is_basehit / is_single / is_double / is_triple / is_home_run | bit          | yes  |                                                            |
| is_strikeout / is_walk / is_sac / is_sf                      | bit          | yes  |                                                            |
| batted_ball_type                                             | varchar(20)  | yes  | only on balls in play (`fly_ball`…)                        |
| launch_speed                                                 | decimal(5,1) | yes  | exit velo; `NULL` if not in play                           |
| launch_angle                                                 | decimal(5,1) | yes  | `NULL` if not in play                                      |
| launch_speed_angle                                           | tinyint      | yes  | Statcast category                                          |
| hit_distance                                                 | smallint     | yes  | projected feet                                             |
| estimated_ba                                                 | decimal(5,3) | yes  | xBA for this batted ball (`estimated_ba_using_speedangle`) |
| runner_on_1b / \_2b / \_3b                                   | int          | yes  | runner `player_id` or `NULL`; not FK-enforced              |

> Names in this feed are `"Last, First"` (unlike other tables). Statcast is the Savant
> source; the catalog's separate **Play-by-play** feed (`/withMetrics` pitch events →
> `mlb.play_by_play`) is the same grain from the Stats API, carrying `batterGameAtBatID`,
> `atBatNumber`, `pitchNumber`, `playEvent_code/description`, `pitchStartSpeed`,
> `pitchZone`, `strikeZoneTop/Bottom`, `hit_launchSpeed/launchAngle/totalDistance/
trajectory/hardness/hitProbability/batSpeed`, last-pitch `result_eventType/rbi/isOut`,
> `atBat_isScoringPlay`, and the `isLastPitch` flag. Prefer Savant for tracking data
> (bat speed, expected stats), the Stats API feed for scoring/result context.

---

# Layer 2 — Derived / pre-computed tables

Built by the Python ETL because Power BI computed them on the fly with DAX (the
pre-computation gap). Fields come from the catalog's nine consolidated entities; types are
**by analogy** to the raw source columns above and should be treated as suggested. `NULL`
is generally possible (a metric may be absent for low-sample players).

## `mlb.player_game_statcast` — Statcast rolled up per player-game

Catalog entity 4 / MAIN per-game log. One row per batter per game (raw Statcast sums +
averages; `runs` joined from `batting_stats`).

| field                                                                  | type~        | notes            |
| ---------------------------------------------------------------------- | ------------ | ---------------- |
| player_id, game_pk, game_date                                          | int / date   | grain + FKs      |
| opposing_pitcher_id, opposing_team_id                                  | int          | matchup context  |
| pa, h, xbh, hr, tb, hip, k, bb, runs, rbi                              | smallint     | counting rollups |
| hr_rate                                                                | decimal(6,3) | `HRR`            |
| avg_ev, max_ev                                                         | decimal(5,1) | exit velocity    |
| avg_la                                                                 | decimal(5,1) | launch angle     |
| avg_dist                                                               | smallint     | hit distance     |
| avg_xba, adj_xba, babip, batting_avg                                   | decimal(5,3) |                  |
| hip_rate, hard_hit_rate                                                | decimal(5,3) |                  |
| l5ab_ev, last2_game_avg_ev, last_game_max_ev, avg_ev_above_escape_velo | decimal(5,1) | rolling windows  |
| last3_game_total_xba                                                   | decimal(6,3) | rolling window   |
| last2_game_hh                                                          | decimal(5,3) | rolling hard-hit |

## `mlb.player_at_bats` — Statcast rolled up per at-bat

Catalog entity 5 / MAIN per-AB log. One row per at-bat. `at_bat_number` is the game-wide
PA sequence, so per-player AB indexing uses `ROW_NUMBER` per (batter, game).

| field                                     | type~          | notes                                                |
| ----------------------------------------- | -------------- | ---------------------------------------------------- |
| player_id, game_pk, at_bat_number, inning | int / smallint | grain                                                |
| result                                    | varchar(50)    | outcome description                                  |
| avg_ev                                    | decimal(5,1)   |                                                      |
| avg_la                                    | decimal(5,1)   |                                                      |
| avg_dist                                  | smallint       |                                                      |
| avg_xba                                   | decimal(5,3)   | `hit_probability` is 0–100 in source — scale on read |

## `mlb.player_patterns` — HR streak / pattern metrics

Catalog entity 6 / HR-pattern card. One row per batter per as-of date. Definitions are the
project's own (the PBI DAX was inferred): window = 5 games, rows are through-date-**inclusive**,
same-season. Reader rule: take the latest `as_of_date` **strictly before** the game you're
researching.

| field                 | type~        | notes                                            |
| --------------------- | ------------ | ------------------------------------------------ |
| player_id, as_of_date | int / date   | grain                                            |
| pattern_hit_rate      | decimal(5,3) | HR-repeat rate within the 5-game window          |
| games_since_hr        | smallint     |                                                  |
| hr_pattern_early      | decimal(5,3) | next 1–2 games split                             |
| hr_pattern_late       | decimal(5,3) | 3–5 games split                                  |
| hr_hot_flag           | bit          | in-window **and** rate ≥ 0.5 **and** ≥ 3 samples |

## `mlb.player_trend_stats` — rolling trends & platoon splits

Catalog entity 7 / MAIN platoon-split pivot. Rolling per-player metrics, including
per-pitcher-hand (`vs_lhp_*` / `vs_rhp_*`) quality-of-contact splits.

| field                                                         | type~        | notes                                |
| ------------------------------------------------------------- | ------------ | ------------------------------------ |
| player_id                                                     | int          | grain                                |
| pitcher_hand                                                  | char(1)      | split key (`L` / `R`) where per-hand |
| pa, h, xbh                                                    | smallint     |                                      |
| avg_ev, avg_dist, last2_game_avg_ev, avg_ev_above_escape_velo | decimal(5,1) |                                      |
| last3_game_total_xba                                          | decimal(6,3) |                                      |
| adj_xba, avg_xba, hip_rate, babip, batting_avg, hard_hit_pct  | decimal(5,3) | per-hand quality of contact          |

## `mlb.batter_context` — batter identity per game

Catalog entity 2 / MAIN identity card. One row per batter per game (facts split out from
the PBI `BATTER` table's static side).

| field                   | type~               | notes             |
| ----------------------- | ------------------- | ----------------- |
| player_id, game_pk      | int                 | grain + FKs       |
| player_name, team_id    | varchar / int       |                   |
| batting_order           | smallint            | lineup spot × 100 |
| side                    | char(1)             | `H` / `A`         |
| game_display, game_time | varchar / datetime2 |                   |

## `mlb.batter_projections` — pre-computed model outputs per game

Catalog entity 3 / MAIN predictions table. The PBI `BATTER._x*` measures. **Stored
long-format**: `(game_date, game_pk, batter_id, market_key, value)` — the catalog's wide
`_x*` list are the `market_key` values; the API pivots long → wide for display.

Market keys (from the catalog's `_x*` set, plus proj-v1.1 probability outputs):
`_xH, _x1B, _x2B, _xHR, _xXBH, _xTB, _xR, _xRBI, _xBB, _xK, _xHRR`, and `hit_prob`,
`hr_prob` (P(≥1 in the game) = 1 − (1 − p_pa)^expectedPA). `value` is `decimal`.

## `mlb.career_batter_vs_pitcher` — lifetime batter-vs-pitcher matchup

Catalog entity 8 / VS card + table. One row per (batter, pitcher) pair, aggregated
lifetime. The per-**game** source is the audit's `_playerVsStats` (key
`batter_pitcher_id-game_pk`, `LastRefreshDate`); the career table sums it (excluding
non-PA event noise). Column names starting with digits/`%` in the source are renamed.

| field                                     | type         | null | notes                                  |
| ----------------------------------------- | ------------ | ---- | -------------------------------------- |
| batter_id (player_id)                     | int          | no   | FK → players                           |
| pitcher_id (vs_pitcher_id)                | int          | no   | FK → players                           |
| pa                                        | smallint     | yes  |                                        |
| h                                         | smallint     | yes  |                                        |
| hits_in_play                              | smallint     | yes  | source `HIP` (per-game source only)    |
| singles / doubles / triples / home_runs   | smallint     | yes  | source `1B` / `2B` / `3B` / `HR`       |
| xbh                                       | smallint     | yes  |                                        |
| tb                                        | smallint     | yes  |                                        |
| strikeouts / walks                        | smallint     | yes  |                                        |
| barrels                                   | smallint     | yes  |                                        |
| batting_avg (BA)                          | decimal(5,3) | yes  |                                        |
| slg                                       | decimal(5,3) | yes  |                                        |
| woba                                      | decimal(5,3) | yes  |                                        |
| x_ba / x_slg / x_woba                     | decimal(5,3) | yes  | Statcast expected stats                |
| k_pct / bb_pct / whiff_pct / hard_hit_pct | decimal(6,3) | yes  | source `K%` / `BB%` / `Whiff%` / `HH%` |
| babip                                     | decimal(5,3) | yes  |                                        |
| exit_velocity (EV)                        | decimal(5,1) | yes  |                                        |
| launch_angle (LA)                         | decimal(5,1) | yes  |                                        |
| hit_distance (Dist)                       | smallint     | yes  |                                        |

---

# Cross-source reference

## Shared keys

| key               | type        | grain          | appears in                                                                                                 |
| ----------------- | ----------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| player_id         | int         | player         | players, batting_stats, pitching_stats, season tables, statcast_pitches, all derived batter tables         |
| team_id           | int         | team           | teams, players, games, batting_stats, season tables                                                        |
| game_pk           | int         | game           | games, batting_stats, pitching_stats, statcast_pitches, play_by_play, player_game_statcast, player_at_bats |
| batter_game_id    | varchar(30) | batter-game    | `player_id-game_pk` — `batting_stats` PK                                                                   |
| batter_pitcher_id | varchar(30) | batter-pitcher | `player_id-vs_pitcher_id` — per-game BvP / career BvP grain                                                |
| play_id           | varchar(50) | pitch          | `statcast_pitches` PK (Statcast UUID)                                                                      |

## FK / creation order

`teams` → `players` → `games` → `batting_stats` / `pitching_stats` → season tables →
`statcast_pitches` / `play_by_play` → derived tables (`player_game_statcast`,
`player_at_bats`, `player_patterns`, `player_trend_stats`, `batter_context`,
`batter_projections`, `career_batter_vs_pitcher`).

## Reconciliation with the stale audit

- **Azure → SQL Server 2022.** The audit's Azure SQL notes, `IDENTITY` surrogate keys, and
  `GETUTCDATE()` DDL are historical. Current keys are the natural MLB ids and composite
  keys above.
- **Table names not adopted.** The audit proposed `mlb.team_game_stats` (kept as a logical
  view here) and `mlb.batter_vs_pitcher` (the built table is `mlb.career_batter_vs_pitcher`,
  at lifetime grain rather than per-game).
- **Not in the audit workbook.** The derived Layer-2 tables (`player_game_statcast`,
  `player_at_bats`, `player_patterns`, `player_trend_stats`, `batter_context`,
  `batter_projections`) postdate the xlsx model — they come from the catalog's nine
  entities and the ETL that realizes them.
- **Physical truth.** For exact live column names and types, `database/mlb/bootstrap.sql`
  is authoritative; this dictionary is the semantic layer over it.
