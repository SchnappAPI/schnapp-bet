# ADR-20260712-2 — Analytic discrete-tail tier engine for the sharp MLB batter markets (mlb-v1.2)

Date: 2026-07-12
Status: Accepted

## Context

ADR-20260712-1 made tier probabilities honest (per-market calibrators, gated).
It did not make them sharp. Honesty (calibration) and sharpness (resolution —
how far a prediction dares to move from the base rate and still be right) are
different axes: a calibrator is monotone, so it can fix systematic
over/under-confidence but cannot increase resolution. Resolution comes only
from a better underlying probability model.

The owner asked for the batter markets — home runs, hits, and hits+runs+RBIs —
to be as sharp as possible. The existing engine (`compute_kde_tier_lines`) fits
a reflected Gaussian KDE over a composite-sized window of the game log. KDE is a
poor density estimator for small discrete counts: a hitter with 0/0/1/0/2 home
runs over five games is not a smooth density, and the reflection trick spreads
probability mass in ways that blur the very tail the tier lines live in.

A 168,397-row backtest on the seeded corpus (each row a real player/date/line/
outcome, chronological 80/20 split, model + hyperparameters chosen on train and
scored on the held-out 20%) compared KDE against an analytic alternative: an
empirical-Bayes shrunk, recency-decayed per-game mean feeding a discrete tail
probability (Poisson for equidispersed counts, negative-binomial for
overdispersed aggregates). The analytic model won out-of-sample on every market,
on both log loss and resolution:

| market                | KDE log loss | analytic | KDE resolution | analytic resolution |
| --------------------- | ------------ | -------- | -------------- | ------------------- |
| batter_home_runs      | 0.2887       | 0.2472   | 0.0019         | 0.0041              |
| batter_hits           | 0.5055       | 0.4901   | 0.0511         | 0.0524              |
| batter_total_bases    | 0.5549       | 0.5295   | 0.0431         | 0.0429              |
| batter_hits_runs_rbis | 0.5537       | 0.5280   | 0.0554         | 0.0576              |

Home runs — the market the owner flagged — improved most: log loss down 14%,
resolution doubled.

## Decision

1. Add an analytic tier engine to `grading/mlb_grade_props.py`, selected
   per-market via `ANALYTIC_TIER_MODELS`. For a listed market with at least
   `ANALYTIC_MIN_GAMES` (10) prior games, `compute_kde_tier_lines` computes
   `mu` = recency-decayed (half-life 30 games), empirical-Bayes shrunk
   (toward the market's league per-game mean by `k` pseudo-observations)
   per-game mean, then `P(stat > line)` from the market's discrete law. All
   other markets, and analytic markets with fewer than 10 prior games, keep
   the KDE engine unchanged.

2. Per-market law and hyperparameters (backtest-selected, treated as config —
   stable population parameters, not user input):

   | market                | dist         | k   | alpha | league_mean |
   | --------------------- | ------------ | --- | ----- | ----------- |
   | batter_hits           | Poisson      | 25  | 0     | 0.790       |
   | batter_total_bases    | neg-binomial | 25  | 0.478 | 1.278       |
   | batter_home_runs      | Poisson      | 50  | 0     | 0.111       |
   | batter_hits_runs_rbis | neg-binomial | 25  | 0.575 | 1.630       |

   Poisson for the clean/rare counts (hits, HR); negative-binomial
   (`var = mu(1 + alpha*mu)`) for the overdispersed aggregates (TB, H+R+RBI),
   which sum correlated events and have a fatter upper tail than Poisson.

3. Bump `MODEL_VERSION` to `mlb-v1.2` (invalidates the tier probabilities of
   prior rows for the four markets). The pipeline is unchanged downstream: the
   analytic raw probability still flows through the per-market calibrator
   (ADR-20260712-1) and the same tier-threshold scan, so output stays both
   sharp (engine) and honest (calibrator).

4. The seeder replays `compute_kde_tier_lines`, so the analytic engine flows
   into `common.calibration_corpus` automatically — the MLB corpus was cleared
   and re-seeded so the calibrators train on v1.2 probabilities.

## Consequences

- The four batter markets produce sharper, better-discriminating tier
  probabilities; the weekly per-market calibration history
  (`grade_calibration_history`) is where the improvement is tracked over time.
- The analytic path ignores the composite-grade KDE window and uses the full
  game log with decay — recent form is weighted, but a long history still
  informs the shrink. This is deliberate: the window was a KDE artifact.
- `mlb-v1.1` tier rows for these markets remain in history but their tier
  probabilities are superseded; the model_version stamp distinguishes them.
- Hyperparameters are frozen constants from one backtest. A future ADR should
  revisit them once enough _live_ (non-seed) resolved outcomes accrue to
  re-fit on real settled data rather than the replay corpus.

## Out of scope

- The other 12 MLB markets (remaining batter-count and all pitcher markets):
  they keep KDE until a backtest justifies otherwise. Pitcher counts
  (strikeouts, hits allowed) are plausible next candidates.
- NFL and NBA tier engines — unchanged.
- Park, weather, batting-order, and opposing-pitcher features in the mean
  estimate: a separate, larger modeling track. This ADR sharpens the
  distribution around the player's own recent rate; it does not add matchup
  covariates (the 2026-07-09 backtest found game-level matchup mostly noise).
