# Glossary

Domain vocabulary for the project. Cross-sport terms come first, then sport-specific sections.

## Cross-sport terms

**At a Glance**: A grid view that surfaces all upcoming player props across all games for a sport, sorted and filterable by signal strength, odds, and other criteria. Designed for quick scanning before placing bets.

**Blowout dampening**: An adjustment applied inside `compute_kde_tier_lines` for points and combo markets. When the pre-game spread is 10.5 or larger and the player is on the projected losing team, half of the player's historical blowout-loss points delta is subtracted from every value in the KDE input sample before fitting. Tier lines for that player-market-game come out correspondingly lower. Has no effect on rebounds, assists, or threes markets.

**Blowout profile**: Per-player historical delta between points averaged in blowout losses versus close games. Stars who get benched in blowouts (Curry, SGA, KAT) have large negative deltas; garbage-time role players have positive deltas. Computed by `fetch_player_blowout_profiles` from full season box score history.

**Brier score**: Mean squared error between predicted probability and actual 0/1 outcome. Lower is better; 0 is perfect, 0.25 is random guessing at 50%. Used to measure tier calibration quality.

**Calibration**: Whether a predicted probability matches the actual hit rate at that probability level. A well-calibrated 70% prediction should correspond to a 70% observed hit rate across many events.

**Composite grade**: A 0 to 100 score combining the three grading components that actually move prediction quality: 40% momentum grade, 40% (hit rate over last 60 games scaled to 0-100), 20% pattern grade. Formula defined in `docs/decisions/ADR-20260423-1-composite-formula-reweight.md` and implemented in `compute_composite()`. Components that proved non-predictive (trend, matchup, regression, all six opportunity grades) are stored on `common.daily_grades` as context columns but are NOT folded into the composite mean. For Under rows, component values are inverted via `100 - value` before the weighted sum.

**Connected visual**: A page-level pattern where multiple visuals on the same page subscribe to a shared selection state (typically a selected player). Tapping a different player updates every visual at once. See `docs/PRODUCT_BLUEPRINT.md`.

**Demo mode**: A passcode-gated mode that shows the site as it appeared on a fixed historical date so prospective users can explore without seeing live data. Configured in `common.demo_config`.

**EV%**: Expected value percentage on a posted alternate line, computed by Phase 5 logistic model. Positive means the implied probability of the market price is lower than the model's probability — the bet has positive expected value. Sorted descending in `common.player_value_lines`.

**Game page**: The hub view for a single matchup. Contains lineups, props, live stats, matchups, and the at-a-glance summary scoped to that game.

**Grade**: A 0 to 100 score on a single prop reflecting predicted strength. Subdivided into component grades that each measure one signal (recent form, momentum, matchup, etc.).

**Grading**: The pipeline that produces grades and value lines. Runs after odds ingestion fetches the day's lines.

**KDE (kernel density estimate)**: Non-parametric fit of a continuous probability distribution to a sample. Used by `compute_kde_tier_lines` (MLB only post-grading-v2) to turn a player's game log into a full distribution over possible stat outcomes. NBA grading now uses the logistic model from Phase 5 instead.

**KDE window**: Grade-weighted lookback for KDE fitting. Composite grade 80+ uses the last 15 games (player is peaking, recent form matters). Grade 50-79 uses the last 30 games (balanced). Grade under 50 uses the full season (recent form is uninformative). Below 10 games available, the function falls back to a normal distribution.

**Outcome**: Over or Under on a prop line. Each (player, market, line) can have both outcomes graded separately as of grading schema v3 (`docs/decisions/ADR-20260402-1-grading-schema-v3.md`).

**Player page**: The drill-down view for a single player. Shows game log, splits, current props, and recent trends.

**Player prop**: A bet on whether a specific player's stat will go over or under a posted line. Distinct from team props (game total, spread).

**Posted line**: The standard line offered by the bookmaker. Distinct from alternate lines (alt lines), which are offered at varied prices for the same market.

**Signal**: A discrete tag attached to a prop indicating a notable pattern. Examples: STREAK (strong recent run), DUE (bounce-back from miss streak), HOT/COLD (player-level form).

**STATUS line**: The first line of every component README, stating one of: `live` (production), `in development` (active work, not yet live), `idle` (infrastructure exists, no active development), `design phase` (planning underway, no code), `not started` (no code, no design). Sessions should not invent new STATUS values.

**Tier line**: One of four model-derived line values per (player, market, game) produced by `compute_kde_tier_lines`, written to `common.player_tier_lines`. Tiers: Safe ≥80%, Value ≥58%, High Risk ≥28% + price ≥+150 + within 0.5 of model line, Lotto ≥7% + price ≥+400 + composite ≥50. NBA replaced these with `common.player_value_lines` in grading-v2 (`docs/decisions/ADR-20260505-1-player-value-lines.md`); MLB still uses them.

**Value line**: Per-line EV%-based entry in `common.player_value_lines`. One row per positive-EV Over alternate line per (player, market, game). Sourced from the Phase 5 logistic model. Replaces NBA tier lines.

## NBA-specific

**3PM, 3PA, FG, FGM, FGA, FT, FTM, FTA**: Standard basketball stat abbreviations.

**boxscoretraditionalv3, leaguedashptstats, playergamelogs**: NBA Stats API endpoints used by the ETL.

**G/F/C grouping**: Position groups used in the matchup defense view. PG and SG map to G; SF and PF map to F; C is C. Implemented in `posToGroup()`. Do not use `position[0]` for grouping.

**MIN**: Minutes played, shown as `mm:ss` (e.g., `21:49`). Prefix `*` indicates the player started.

**PRA, PR, PA, RA**: Composite scoring stats. PRA = points + rebounds + assists. PR = points + rebounds. PA = points + assists. RA = rebounds + assists. All four are common prop markets.

**Period**: A quarter or overtime segment. Stored as `'1Q'`, `'2Q'`, `'3Q'`, `'4Q'`, `'OT'` in `nba.player_box_score_stats`. The column is VARCHAR(2); do not insert longer values.

**Trends Grid**: Tab on the NBA game page reading `common.player_tier_lines` (legacy) or `common.player_value_lines` (current). Stat toggle across PTS, REB, AST, 3PM, PRA, PR, PA, RA. Game window toggle 10/30/all.

## MLB-specific

**At Bat (AB)**: A plate appearance that resulted in a hit, out, or other completed at-bat (excludes walks, HBP, sacrifices). Tracked at the pitch level in Statcast data.

**Barrel**: A batted ball with combination of exit velocity and launch angle that historically produces a high slugging percentage. Tracked as `is_speedangle_barrel` in Statcast.

**BABIP**: Batting average on balls in play. Excludes home runs and strikeouts from both numerator and denominator.

**Batter vs Pitcher (BvP)**: Career stats for a specific batter against a specific pitcher. Pulled from Baseball Savant's matchup endpoint.

**Box score**: Full per-player stats for a single game. From the MLB Stats API `/withMetrics` endpoint, both game-level and season-level versions are included in one response.

**Exit velocity (EV)**: Speed of the ball off the bat in mph. Statcast measurement.

**Hard hit**: Batted ball with exit velocity 95 mph or higher. Tracked as `is_hit_into_play_hardhit`.

**Hot/Cold zones**: A 13-zone grid representing the strike zone, with each zone showing a player's batting average, OBP, SLG, or xBA.

**Plate appearance (PA)**: Any time a batter completes a turn at the plate, including walks, HBP, sacrifices, and at-bats. Superset of "at bat".

**Probable pitcher**: The starting pitcher expected to pitch in an upcoming game. Pulled from MLB Stats API schedule with `hydrate=probablePitcher`.

**Spray chart**: Visual showing where a batter's hits go in the field. Statcast-derived.

**Statcast**: MLB's pitch-tracking system. Provides exit velocity, launch angle, expected stats, swing path, timing metrics, and many other measurements at the pitch level.

**withMetrics endpoint**: `https://statsapi.mlb.com/api/v1/game/{gameID}/withMetrics`. Single endpoint that returns box scores, season stats, play-by-play, and pitch data for a game.

**xBA, xSLG, xwOBA**: Expected stats based on exit velocity and launch angle, independent of defensive positioning.

## NFL-specific

To be populated as NFL build progresses. Placeholder for terms like snap count, target share, route participation, red-zone usage.
