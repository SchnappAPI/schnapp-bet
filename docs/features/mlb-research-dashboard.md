# MLB Research Dashboard — Build Plan (mlbSavantV3 port)

Port of the Power BI report `mlbSavantV3` (and its desktop siblings) into the web app.
Source material: three catalog documents (2026-07) that reverse-engineered the PBI file —
data sources, page/visual inventory, and nine consolidated data entities — plus two
dashboard screenshots and a screen recording of the published report.

This is the planning spec. It reconciles the PBI catalog against what the repo already
has, decides the pre-compute strategy the catalog flagged as "the most important design
decision," and sequences the build into commit-sized phases.

## What the report is

A batter prop-research surface with five distinct concepts (the PBI file's 8–10 pages
collapse to these — MAIN/New/Extra/Criteria were copies):

| Concept                | Content                                                                                                                                                          | Web home                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Batter analysis (MAIN) | identity card, projections row, game log, per-AB log, HR pattern card, BvP card + table, opposing-pitcher season stats, team overview pivot, platoon split pivot | `/mlb/player/[playerId]` (exists, extend)        |
| EV                     | team-wide heat grid (both lineups) + per-AB Statcast log, sliced by date range / game / pitcher hand / AB number                                                 | `/mlb/research` (shipped Phase 3)                |
| VS                     | full-lineup career BvP pivot + pitcher season stats, home/away slicer                                                                                            | `/mlb/research` batter detail + game Lineups tab |
| Proj                   | lineup-wide projections pivot                                                                                                                                    | Phase 4 (projections markets)                    |
| Pitcher view           | pitcher game log, career splits, projected HA/HRA, vs-lineup BvP                                                                                                 | not yet built (retired 6-tab view deleted)       |

The signature visual style everywhere: percentile-interpolated **background** color
scales on table cells (heatmap tables), plus slicer chips driving cross-filtering.

## Entity map: PBI catalog → repo

The catalog's nine consolidated data entities, against the live schema:

| #   | Entity                                                                                                                                      | Repo state                                                                                                                      | Gap                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Upcoming games (display, time, probable SPs, hands)                                                                                         | `mlb.games` — probable pitcher IDs + `*_pitcher_hand` populated by ETL self-heal                                                | none (gameDisplay/doubleheader ordinal is trivial SQL)                                                              |
| 2   | Batter context per game (order, side)                                                                                                       | `mlb.batter_context` + `mlb.daily_lineups` (confirmed; projected derived at read time per ADR-20260704-1)                       | none                                                                                                                |
| 3   | Batter projections per game (`_xH … _xHRR`, `H_prob`, `HR_prob`)                                                                            | `mlb.batter_projections` — long format `(game_date, game_pk, batter_id, market_key)`                                            | new market keys for probability outputs; API pivots long→wide                                                       |
| 4   | **Player game stats** (Statcast aggregated per player-game: PA, H, XBH, HR, TB, avgEV, maxEV, avgXBA, HIP, hard-hit, BABIP, K, BB, R, RBI…) | derivable from `mlb.player_at_bats` + `mlb.batting_stats`, **not pre-aggregated**                                               | **new table `mlb.player_game_statcast`** (Phase 1)                                                                  |
| 5   | Per-at-bat log (result, EV, LA, dist, xBA, AB number, inning)                                                                               | `mlb.player_at_bats` — complete, including `at_bat_number` (the AB-number slicer works as-is)                                   | none                                                                                                                |
| 6   | Patterns (HR Hot, pattern hit rate, games since HR, early/late)                                                                             | nothing MLB-side (`common.player_line_patterns` is props-line patterns, different concept)                                      | **new table `mlb.player_patterns`** (Phase 4)                                                                       |
| 7   | Platoon splits, rolling (per-hand EV/xBA/HIP/BABIP)                                                                                         | `mlb.player_trend_stats` has `vs_lhp_*`/`vs_rhp_*` hit-rate only; `play_by_play.pitcher_hand_code` makes full splits computable | extend trend computation with per-hand quality-of-contact columns                                                   |
| 8   | Career BvP (counting + Statcast quality: EV, xBA, barrels, whiff%)                                                                          | `mlb.career_batter_vs_pitcher` — counting stats + AVG/OBP/SLG/OPS                                                               | quality-of-contact columns; see xBA decision below                                                                  |
| 9   | Pitcher season stats                                                                                                                        | `mlb.pitcher_season_stats` + per-game `mlb.pitching_stats`                                                                      | none for season; pitcher-perspective Statcast agg comes free from entity 4 (group `player_at_bats` by `pitcher_id`) |

Bottom line: entities 1, 2, 5, 9 are done; 3, 7, 8 are extensions; 4 and 6 are the only
net-new tables.

## Decisions

**D1 — Pre-compute per player-game, slice in SQL by date.** The catalog's
"pre-computation gap" warning is right, but the answer isn't one table per window.
`mlb.player_game_statcast` (one row per batter per game, ~4.9k games x ~20 batters/season)
is small enough that "last N days," "last N games," "season to date," and "since date X"
are all cheap `WHERE game_date >= @from` aggregations over an indexed table at request
time. Only true rolling/pattern state (entity 6) and per-hand splits (entity 7) stay in
nightly pre-compute, because they need window functions over history. This keeps the DAX
flexibility (arbitrary date slicing) without materializing every window.

**D2 — xBA is the StatsAPI `hit_probability` proxy for v1.** The DB's per-AB xBA is
`hitData.hitProbability`, not Savant's `estimated_ba_using_speedangle`. True Savant xBA
(plus whiff/barrel flags, bat speed, attack angle) lives only in the Azure Parquet lake
(`etl/backfill/mlb/backfill_statcast.py`) with no SQL join. v1 ships the proxy, labeled
`xBA*` in the UI. A later phase can land Savant Parquet into SQL keyed by
(game_pk, at_bat_number) — Savant rows carry `game_pk` and `at_bat_number`, so the join
is mechanical once the loader exists.

**D3 — Hard-hit/barrel definitions stay in lockstep.** EV >= 95 hard-hit, EV >= 95 & LA 8–32
barrel, defined in `etl/mlb_play_by_play.py` and mirrored in `web/app/mlb/statcastFormat.ts`.
New aggregates reuse those constants; nothing invents a third definition.

**D4 — Ballpark Pal columns are out of scope.** The screenshots' "Ballpark Pal
Projections" are a third-party model's outputs. Our equivalent is
`grading/compute_mlb_projections.py` writing new market keys (D5); we do not scrape or
imitate BP numbers.

**D5 — Projections stay long-format.** New probability market keys (`hit_prob`,
`hr_prob`, plus `x1b/x2b/xxbh/xtb/xhrr` as the model grows) are added to
`mlb.batter_projections` rather than widening the table. The research API pivots.

## Phases

Each phase is one or two conventional commits, independently shippable, ordered so the
UI never waits on data it can't render.

### Phase 1 — data layer (`etl/mlb_play_by_play.py` + bootstrap regen)

1. New table `mlb.player_game_statcast` — one row per (batter_id, game_pk):
   `game_date, team_id, opp_team_id, opp_pitcher_id (first faced), pa, ab, h, singles,
doubles, triples, hr, xbh, tb, r, rbi, so, bb, hbp, sf, hip (balls in play), hip_rate,
avg_ev, max_ev, avg_la, avg_dist, avg_xba, hard_hit_ct, barrel_ct, babip_numer/denom`.
   Built in the same nightly pass that already writes `player_at_bats` (incremental by
   game_pk, same MERGE pattern). R/RBI/BB/SO reconciled from `mlb.batting_stats` where
   the box score is authoritative.
2. Extend `mlb.player_trend_stats` per-hand splits: `vs_lhp_avg_ev, vs_lhp_avg_xba,
vs_lhp_hard_hit_pct, vs_lhp_xbh, vs_lhp_babip` (+ RHP mirrors), computed from
   `play_by_play.pitcher_hand_code`. Append-only columns — CRITICAL_FIELDS review per
   `etl` rules.
3. BvP quality-of-contact: add `avg_ev, avg_la, avg_dist, avg_xba, hard_hit_ct,
barrel_ct` to `mlb.career_batter_vs_pitcher`, aggregated from our own
   `player_at_bats` history (covers ingested seasons; column comment marks the horizon).
4. `/skill regenerate-bootstrap-sql` after DDL lands; indexes:
   `IX_player_game_statcast_batter (batter_id, game_date)` and `(game_date)`.

Verification: dispatch `mlb-pbp-etl.yml`, spot-check 3 batters' last-7-days EV/hard-hit
against Baseball Savant leaderboards; row counts vs `batting_stats`.

### Phase 2 — API layer (`web/app/api/mlb/research/...`)

One payload per page concept, mirroring the PBI cross-filter model (client slices,
server aggregates):

1. `GET /api/mlb/research/slate?date=` — entity 1 + 2: games with display labels,
   probable SPs + hands, lineups. Feeds the Game/slicer row.
2. `GET /api/mlb/research/grid?gamePk=&from=&to=&hand=&abNum=` — the heat grid: both
   lineups, per-batter aggregates over the date window (SQL over
   `player_game_statcast`; `abNum`/`hand` filters drop to `player_at_bats`/`play_by_play`
   grain), plus trend/pattern columns and pivoted projections. This is the catalog's
   "most complex visual" (Visual 9) as a single endpoint.
3. `GET /api/mlb/research/atbats?batterId=&from=&to=&hand=&abNum=` — per-PA log
   (thin wrapper over existing `mlb-atbats`/`mlb-ev` logic, unified filters).
4. Existing `mlb-bvp`, `mlb-proj`, `mlb-pitcher` extended with the new columns rather
   than duplicated.

All routes: `getPool()`, `apiError.ts`, ETag via `web/lib/etag.ts`.

### Phase 3 — UI (`web/app/mlb/research/`)

1. **Heatmap cell primitive** — `web/components/HeatCell.tsx` + a `colorScale.ts`
   helper: value → percentile within the visible column → interpolated background
   (green/white/red like the PBI report), dark-mode aware, null-safe. This is the one
   genuinely new visual component; everything else is composition.
2. **Slicer row** — date-range chips, game selector, pitcher-hand toggle, AB-number
   chips (1–6). Pattern lifted from `web/components/nba/PlayerLogFilters.tsx`
   (URL-search-param driven).
3. **Research page** — `/mlb/research`: slicer row → team heat grid → click a batter →
   per-PA log + BvP panel + platoon split strip (the EV-page layout from the video,
   with MAIN's detail panels on selection).
4. Retrofit: live game tabs (`MlbGameTabs`) adopt HeatCell so game tabs and the
   research page read identically. (The retired 6-tab views were retrofitted first,
   then deleted 2026-07-04 as orphans once `/mlb/research` shipped.)

Verification cadence per CLAUDE.md: browser/curl check between commits — never stack
3+ UI commits blind.

### Phase 4 — patterns + projection markets

1. `mlb.player_patterns` (one row per batter per as-of date): `pattern_hit_rate,
games_since_hr, hr_pattern_early, hr_pattern_late, hr_hot` — computed nightly in the
   pbp ETL from `player_game_statcast` history; definitions documented in the table DDL
   comment (the PBI DAX for these is inferred, so we define them explicitly and mark
   them ours).
2. `compute_mlb_projections.py` adds `hit_prob` / `hr_prob` market keys (model layer on
   entities 4–7). HR pattern card + projections row light up on the player page.

**Data layer shipped 2026-07-05 (cloud session).** Our explicit pattern definitions
(constants in `etl/mlb_play_by_play.py`, prose at `DDL_CREATE_PATTERNS`): a batter is
"in pattern" for 5 games after an HR game; `pattern_hit_rate` = share of HR games
followed by another HR game within those 5; early = repeat in the next 1–2 games,
late = 3–5; `hr_hot` = currently inside the window (`games_since_hr < 5`) with
rate >= 0.5 over >= 3 samples. Same-season scope, through-date-inclusive rows —
readers pick the latest `as_of_date` before the upcoming game. Backfill green
(run 28726425148, ~123k rows). `hit_prob`/`hr_prob` = P(>= 1) via
`1 - (1 - platoon-adjusted per-PA rate)^expectedPA`, proj-v1.1. Still open from this
phase: the player-page HR pattern card + projections-row surfacing (web).
**All remaining work is sequenced in `mlb-research-dashboard-remainder.md`** —
the step-by-step executor plan (Phases A–E) written for the follow-up sessions.

### Phase 4.5 — Gamefeed adoptions (2026-07-04)

Reviewed Baseball Savant's Gamefeed (per-game tab strip, day-level leaderboard rails,
EV-table chip format) as design input. Adopted formats below; rejects appended to
"Explicitly cut". Bias: pregame batter research + postgame review, not broadcast
companion. Data note: nightly `mlb.play_by_play` is pitch-grain (`pitch_start_speed`,
`pitch_call_code`, `pitch_type_code`), so pitch-velocity/whiff aggregates are feedable
postgame — only Savant tracking data (spin, movement, 3D, true xBA) waits for Phase 5.

1. **Day-level "Top ..." leaderboard rails on `/mlb`** — Savant's Top Exit Velocity /
   Top Distances / Top Pitch Velocity / Swing & Misses as small ranked slate-wide
   tables. Ours: one `GET /api/mlb/research/leaders?date=` route; EV / distance / bat
   speed / HR-Park near-misses from `mlb.player_at_bats`, pitch velo + whiffs from
   `mlb.play_by_play`. Nightly grain — rails read "yesterday" until the day's pbp lands;
   label the date, never imply live.
2. **Named-threshold chips + once-per-page legend** — Savant chips hard-hit (EV >= 95),
   barrel, fast swing (bat speed >= 75). Where a threshold has a name, chip it instead of
   bare percentile shading. Chip defs live beside the D3 constants in
   `web/app/mlb/statcastFormat.ts`; one shared legend component used by the Exit Velo
   game tab, the research per-PA log, and the player Statcast section.
3. **HR/Park + Bat Speed columns** — `home_run_ballparks` (render `n/30` like Savant)
   and `hit_bat_speed` already land per AB. Surface in the three at-bat tables:
   `web/app/mlb/MlbGameTabs.tsx` (Exit Velo tab), `web/app/mlb/research/MlbResearchView.tsx`
   (per-PA log), `web/app/mlb/player/[playerId]/MlbStatcastSection.tsx` (already fetches
   both fields, renders neither).
4. **Status-keyed tab set + pregame Matchups framing** — Savant swaps one slot by
   `codedGameState` (Live At Bat while live, Matchups when final) and suppresses stat
   tabs pregame. Adapt: `MlbGameTabs.tsx` keys tab availability off
   `web/app/mlb/gameStatus.ts` — pregame shows Lineups + a new Matchups tab
   (lineup-vs-probable BvP, data already served for the research page); final shows
   Box Score + Exit Velo.

### Phase 5 (optional, later) — true Savant enrichment

Loader that lands Azure Parquet Statcast (2024→) into a `mlb.statcast_pitches` table
keyed (game_pk, at_bat_number, pitch_number): true xBA/xSLG/xwOBA, whiff/swing flags,
bat speed, attack angle. Unlocks Whiff% in BvP and swaps the xBA proxy out. Separate
ADR when we get here.

## Explicitly cut (from the catalog, confirmed)

- The four duplicate batter pages — one player analysis view, one research view.
- Hot/cold strike-zone visual (`hotColdZones` endpoint) — not in the videos' working
  set; revisit after Phase 4 if wanted.
- Live in-game Savant `/gf` boxscore — the live-scores overlay (2026-07-04) already
  covers live; per-AB live data waits for pbp-during-games.
- Venue/park-factor table — `common.game_supplemental` + venue fields already exist;
  no BP park model.

From the Gamefeed review (2026-07-04, see Phase 4.5):

- Illustrator / Pitch 3D / Film Room / Vizcast — broadcast spectacle, zero prop-research
  signal.
- Win Probability tab + the scoreboard WPA sparkline — we have no win-probability model
  and game-level WP is not a prop input.
- ABS challenge tracking — no data source, no prop relevance.
- Live At Bat tab — live per-AB Statcast stays out until pbp-during-games (extends the
  existing live-boxscore cut above).
- Pitch Velocity game tab + Player Breakdowns (per-pitch-type splits) — pitcher-centric
  grain; nightly pbp could feed a crude version, but Savant-quality classification/spin
  is Phase 5 material. Revisit after Phase 5 if pitcher research becomes a goal.

## Sequencing note

Phases 1–2 are Python + SQL and run through GitHub Actions / the Mac (per repo rules —
no local Python here). Phase 3 is web-only and can be built and browser-verified on the
dev server independently once Phase 2 endpoints return data. Phase 4 depends on Phase 1
history being populated (needs >= 1 nightly run over the season's backlog).
