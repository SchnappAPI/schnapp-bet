# Playoff Supplemental Grading

A read-only analytical layer that complements `common.daily_grades` with playoff-specific signals the standard model does not consider. Built ad-hoc in chat 2026-05-02 for PHI@BOS Game 7. This document captures the methodology, data contracts, design decisions, and known gaps so it can grow into a proper feature.

This is a feature methodology spec, not a how-to-run README. The current implementation lived at `/tmp/playoff_supplemental_v2.py` on the Mac and is ephemeral. The real artifact is the analytical approach.

This file moved from sports-modeling's `docs/skills/playoff-supplemental.md` to `docs/features/playoff-supplemental.md` because it is a feature spec, not a Claude Code skill.

## Why this exists

The standard NBA grading model (`grade_props.py`) weights regular-season form heavily by design. That works for 82-game prop research and breaks down for postseason and especially Game 7s, where:

- Defenses lock in over a series and by Game 7 have full counters to every recurring action.
- Rotations tighten to 7 or 8 players. Bench guys who averaged 22 minutes in the regular season may play 12 in Game 7.
- Foul exposure on stars rises because both teams hunt mismatches.
- Total scoring drops on average across Game 7s relative to Games 1 to 6 of the same series.
- Star usage compresses because the secondary scoring options get more breathing room.

None of these are features in the standard model. A supplemental layer can surface them without touching production grading.

## Hard constraints

- **Read-only.** This layer never writes to `common.daily_grades`, `common.player_tier_lines`, or any production table. Output is a CSV and a printed summary.
- **Does not replace standard grading.** It augments. The standard grade row is still the primary signal; supplemental columns are additive context.
- **Treats series-level stats as directional.** A six-game series is statistically thin. Use it as narrative confirmation, not as a probability estimate.
- **Excludes confirmed inactives.** Players known to be out (orphan props in the odds feed for non-playing players) are filtered before scoring.

## Data contract

### Inputs

| Source | What | Why |
|---|---|---|
| `common.daily_grades` | Standard grade rows for tonight's game | The base signal. Composite, weighted hit rate, hr60, sample sizes. |
| `nba.player_box_score_stats` | Per-quarter box rows for last 200 days plus all playoff lookback games | The supplemental engine. Quarter-level granularity is essential. |
| `nba.schedule` | Final scores and team IDs for completed games | Needed to compute final-margin context for close-vs-blowout splits. |
| Hardcoded inactive list | Players whose props are posted but who will not play | Embiid, Vucevic, etc. on a given night. Sourced manually from injury reports. |

### Critical schema notes

- `nba.player_box_score_stats` stores **one row per player per period per game**. Periods are `1Q`, `2Q`, `3Q`, `4Q`, `OT`. There is no `FullGame` row. Full-game stats require summing across periods per `(player_id, game_id)`.
- `nba.schedule.game_id` format identifies playoff games: prefix `004` is playoffs, `002` is regular season. Filtering on prefix is the canonical way to isolate postseason data.
- `nba.schedule` has `home_team_id`, `away_team_id`, `home_score`, `away_score`. The player's team for a game must be joined from the box score's `team_id`, then the margin computed signed relative to the player's team.
- TBD playoff placeholders (status=1, game_status_text='TBD') get inserted into the schedule with arbitrary dates and must be filtered out wherever recent-completed-game logic runs. The clean rule: `game_status_text != 'TBD' AND game_status = 3` for completed games.

### Market-to-stat mapping

The script translates each `market_key` into a SQL expression that produces the stat from a per-period row. Currently supported markets:

| Market key | Stat expression |
|---|---|
| `player_points`, `player_points_alternate` | `pts` |
| `player_rebounds`, `player_rebounds_alternate` | `reb` |
| `player_assists`, `player_assists_alternate` | `ast` |
| `player_threes`, `player_threes_alternate` | `fg3m` |
| `player_blocks`, `player_blocks_alternate` | `blk` |
| `player_steals`, `player_steals_alternate` | `stl` |
| `player_turnovers`, `player_turnovers_alternate` | `tov` |
| `player_points_rebounds(_alternate)` | `pts + reb` |
| `player_points_assists(_alternate)` | `pts + ast` |
| `player_rebounds_assists(_alternate)` | `reb + ast` |
| `player_points_rebounds_assists(_alternate)` | `pts + reb + ast` |

Unmapped markets are logged and skipped, not failed. Add to the mapping when new markets appear.

## Computed signals

For each `(player_id, market_key, line_value, outcome_name)`:

### Game-context signals (200-day window)

- `overall_avg_200d` — average full-game stat across all completed games in the last 200 days.
- `close_avg` — same average restricted to games with `abs(final_margin) <= 8`.
- `blowout_avg` — same average restricted to games with `abs(final_margin) >= 15`.
- `delta_close_minus_overall` — signed lift in close games. Positive means the player elevates in close games. Game 7 base rate is "close" so this is directly applicable.
- `q1_share`, `q4_share` — fraction of the player's 200-day stat total that came in the first or fourth quarter. High `q4_share` flags garbage-time vulnerability in blowouts.

Margin is computed signed relative to the player's team, but only the absolute value is used for context bucketing. Distinguishing "close win" from "close loss" is a known next step.

### Playoff history signals

- `playoff_n` — number of playoff games this player has stat for in the last 400 days. Captures this postseason plus the prior one.
- `playoff_avg` — mean stat across those games.
- `playoff_min_avg` — mean minutes. Useful for sanity-checking rotation status.
- `playoff_hit_rate_vs_line` — fraction of those games where stat met the line. **Inverted for under-side rows** so the column is always "fraction of times the side cashed."

### Series-only signals (this matchup, this round)

- `series_n` — completed games in the current series.
- `series_avg`, `series_min_avg` — restricted to series.
- `series_min_min`, `series_min_max`, `series_min_volatility` — minutes range across the series. High volatility (>12) on a role player is a Game 7 rotation-risk flag.
- `series_hit_rate_vs_line` — same inversion as playoff hit rate.

### Composite supplemental score

A weighted combination plus the standard composite grade:

```
score = 0.5 * composite_grade
      + 25 * w_playoff * (playoff_hit_rate - 0.5)     [if playoff_n >= 4]
      + 15 * w_series  * (series_hit_rate  - 0.5)     [if series_n  >= 3]
      + clip(close_lift_normalized * 25, -10, +10)    [if close_n   >= 8]
      - 5                                              [if Over and series_min_volatility > 12]
```

where `w_playoff = min(1, playoff_n / 15)` and `w_series = min(1, series_n / 6) * 0.5`. The series weight is capped at half the playoff weight because n=6 should not dominate. The under-side correction inverts the close-lift component sign.

These weights are calibration choices, not derived from data. They have not been backtested. Treat the score as a ranking heuristic, not a probability.

## Output

Two artifacts:

1. **CSV** at `/tmp/playoff_supplemental.csv` (Mac). One row per `(player, market, line, side)`. Columns are the standard grade fields plus all supplemental signals plus the composite supplemental score.
2. **Stdout summary** with two ranked tables: Top 25 by supplemental score (model + supplemental agree), Bottom 15 from rows where standard composite ≥ 60 but supplemental is low (the trap detector).

## Known gaps and next steps

### Calibration

- Composite weights are guesses. A real version would backtest against historical Game 7s and tune.
- The series weight cap of 0.5x is arbitrary.
- The volatility threshold of 12 minutes for the over-penalty is a guess.

### Signal coverage

- **Score-going-into-quarter** is not computed. Highest-value missing signal. Requires play-by-play.
- **Pace-adjusted projections** are absent. Game 7s are typically slower-pace.
- **Foul-trouble exposure** is not modeled. Historical fraction of games where a player picked up 2 fouls in Q1 is computable from PBP.
- **Lineup correlation** is absent.
- **Defensive matchup specificity**. Series average implicitly captures this, but a more direct signal would be sharper.
- **Bench-vs-starter status** is not used.

### Data quality

- **Inactive list is hardcoded.** Should be sourced from a structured injury report.
- **Day-to-day status is unhandled.** No middle ground between fully included and fully excluded.
- **Tatum-out detection** worked accidentally because the odds book did not post Tatum props. A real version should explicitly check the odds feed against the team's roster.
- **Name mismatches.** "Kelly Oubre Jr" vs "Kelly Oubre Jr." appear as separate players in some places. Join on `player_id` not `player_name` everywhere (the current script does, but the data quality issue persists upstream).

### Scope generalization

- **NBA only.** MLB and NFL playoff dynamics differ. The methodology generalizes only partially.
- **Per-round generalization.** First-round Game 7 differs from Conference Finals Game 7.
- **Game number generalization.** Built for Game 7 specifically. Game 1 of a series has the inverse problem.

### Operational

- **No caching of supplemental signals across runs on the same day.**
- **No audit trail.** CSV is overwritten on each run.
- **No web surface.** Output is terminal-only. A future iteration could surface the supplemental score as an additional column on At a Glance, gated by a postseason flag on `nba.schedule`.

## Decisions made along the way

- **`composite_grade >= 60` for the fade detector.** The standard model treats 60 as the rough Tier-2-or-better cutoff. Lower would surface noise; higher would miss model traps.
- **`playoff_n >= 4` and `series_n >= 3` minimums.** Below these thresholds, the hit-rate signal is too noisy.
- **400-day playoff lookback.** Captures this postseason and the prior one.
- **Margin buckets at ±8 and ±15.** Standard NBA cutoffs for "competitive" and "blowout."
- **Under-side hit rate inversion done in Python, not SQL.** Keeps the SQL stat-agnostic.
- **Standard grade row's `over_price` field stores the under price for under rows.** Existing dual-row schema; see `docs/decisions/ADR-20260402-1-grading-schema-v3.md`.

## Cross-references

- `etl/nba/README.md` — production grading entry point and INVARIANTS.
- `database/nba/README.md` — per-period schema of `nba.player_box_score_stats`.
- `docs/decisions/ADR-20260423-1-composite-formula-reweight.md` — current composite formula and tier framework.
