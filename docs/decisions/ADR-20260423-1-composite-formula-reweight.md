# ADR-20260423-1: Composite formula reweighted to momentum/hr60/pattern

Date: 2026-04-23

## Context

The existing composite grade averaged all non-null components with equal weight: hit rate, trend, momentum, pattern, matchup, regression, and four opportunity grades. Grade-outcome correlation analysis on 1.04M resolved rows found that only two components have meaningful predictive lift: momentum_grade (28-point Won-vs-Lost gap) and hit_rate_60 (25-point gap). Pattern_grade has a 3-point gap and is retained as a tiebreaker. All other components — matchup (1.1), regression (slightly negative), trend (effectively zero vs the standard line), all six opportunity grades (0.1 or less) — diluted the composite by pulling it toward 50 and caused the grade 90–100 bucket to collapse (hitting at only 46.4% under the old equal-weight formula, worse than grade 70–80).

## Decision

Rewrite `compute_composite` signature to three arguments: `compute_composite(momentum, hit_rate_60, pattern)`. New weights: 40% momentum + 40% (hit_rate_60 * 100) + 20% pattern. Renormalize when any component is NULL so partial availability still produces a valid 0–100 value. All removed components (matchup, regression, trend, all six opportunity grades) remain computed and written to `common.daily_grades` as context columns — useful for display and future analysis but must not re-enter the composite mean without fresh calibration evidence.

Tier-line behavior also bundled into this ADR: added `compute_kde_tier_lines` and `common.player_tier_lines` table. KDE fitted on grade-weighted game log window (15 games composite≥80, 30 games 50–79, full season <50; normal dist fallback when n<10). Reflection boundary at 0 prevents negative-stat probability mass. Tier cutoffs: safe≥80%, value≥58%, high_risk≥28% with +150 or better, lotto≥7% with +400 or better and composite≥50. Blowout dampening applied at 50% of historical pts delta when spread≥10.5 for pts/combo markets.

Calibration evidence: scipy gaussian_kde calibration on 94,029 records. Shift amplitude of -0.019 produces log-loss improvement of 0.000012 over zero shift — negligible. The correct mechanism for incorporating confidence is grade-weighted lookback window selection for KDE tier computation, not location-shifting the distribution.

New composite vs actual hit rate with reweighted formula (monotonic, no collapse): grade 0–10: 20.8%, 40–50: 46.0%, 60–70: 60.9%, 80–90: 74.8%, 90–100: 82.4%.

## Consequences

- `compute_composite` in `grade_props.py` takes exactly three arguments. Callers passing the old 10-argument signature get a TypeError. Backfill re-grades all historical dates under the new formula.
- `common.player_tier_lines` is a new table (one row per player-market-game-date). Web consumers read this table for tier line display rather than computing tiers client-side. NBA later replaced this with `common.player_value_lines` (see ADR-20260505-1); MLB still uses tier lines.
- The six opportunity grades and matchup/regression/trend columns remain on `common.daily_grades` as context. Adding any of them back to the composite requires calibration evidence showing positive lift.
- Blowout dampening at 50% of the historical player delta avoids over-penalizing a single game context. Revisit once enough blowout-game outcomes have resolved under the new tier framework.
- `fetch_player_blowout_profiles` requires `nba.games` to have `home_score`, `away_score`, `home_team_tricode`, `away_team_tricode`. These come from the CDN box score writer; verify their presence before any environment migration.

## Supersedes

The equal-weight composite from ADR-20260402-1 (legacy ADR-0005) is superseded for `composite_grade` computation. The schema v3 UNIQUE key and table definitions in that ADR remain in force.
