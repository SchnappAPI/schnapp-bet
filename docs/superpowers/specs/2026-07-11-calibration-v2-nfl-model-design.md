# Calibration v2 (sport-aware, gated, seeded) + NFL grading model — design

Date: 2026-07-11. Status: approved for implementation (owner directive: "optimize the
calibration… as reliable as possible… do not limit yourself to what exists; also set up
an NFL model and calibration").

## Problems found (verified against code + live DB)

1. **Calibrator replaced without a gate.** `weekly_calibration.py` fits isotonic buckets
   and unconditionally replaces `common.grade_calibration`. A bad week (thin corpus,
   outlier slate) silently degrades production. The logistic `grade_weights` already have
   a holdout gate; the calibrator itself has none.
2. **Calibration is sport-blind.** `fetch_resolved_corpus` joins
   `common.player_tier_lines` × `common.daily_grades` with no sport filter, and
   `common.grade_calibration` has no sport column (PK = `bucket_min`). Today it works
   only because MLB has zero resolved outcomes. The moment MLB/NFL outcomes exist, all
   sports pollute one shared calibrator. NFL Odds-API market keys share the `player_`
   prefix with NBA, so market-key prefix cannot discriminate — an explicit `sport`
   column is required.
3. **MLB grades never settle.** `mlb_grade_props.py` has no `run_outcomes`; all 204
   MLB rows (2026-05-01, model mlb-v1.0) have `outcome IS NULL`. No settlement → no
   corpus → no calibration → no accountability.
4. **MLB applies no calibrator.** NBA tier probs pass through the isotonic calibrator;
   MLB KDE tier probs are published raw.
5. **Step-function calibrator.** Bucketed isotonic output jumps at bucket edges; two
   near-identical raw probs can map to different calibrated probs.
6. **No proper-scoring metrics.** Nothing records Brier/log-loss/ECE per sport per week,
   so calibration quality is invisible and regressions undetectable.
7. **Push mis-grade (NBA).** `run_outcomes` grades Over as Won when `stat >= line`; an
   integer line with `stat == line` is a push (void), not a win. Pollutes the corpus.
8. **Cold-start.** MLB corpus ≈ 204 rows (odds key dead since May), NFL ≈ 0. A live-only
   corpus leaves both sports uncalibrated for months.

## Approaches considered

- **A. Per-sport isotonic only** (split tables, keep method). Fixes pollution, not
  reliability: no gate, step function, cold-start unsolved.
- **B. Full ML recalibration** (gradient-boosted calibrator, per-market features).
  Overfits at these sample sizes (MLB/NFL corpora are tiny); opaque; violates
  simple-over-complex.
- **C. Chosen: shared calibration core with per-sport candidate selection + holdout
  gate + shrinkage + backtest seeding.** Per sport, fit a small candidate set —
  identity, Platt (2-parameter logistic), shrunk-isotonic with piecewise-linear
  interpolation — score all candidates plus current production on a chronological
  holdout by log loss, and publish the winner only if it beats production. Bucket
  hit-rates get empirical-Bayes shrinkage toward the pooled mean before PAV, so thin
  buckets can't drag the fit. Cold-start solved by a backtest-seeded corpus.

## Design

### 1. Sport dimension (schema, idempotent in-code DDL per existing pattern)

- `common.daily_grades` + `common.player_tier_lines`: add `sport VARCHAR(10) NULL`;
  backfill `mlb` where `model_version LIKE 'mlb%'`, `nfl` where `LIKE 'nfl%'`, else
  `nba` (all 1.2M NULL-model_version rows are NBA-era). Writers stamp sport explicitly
  from now on.
- `common.grade_calibration`: rebuild with PK `(sport, bucket_min)` + columns
  `method` (identity/platt/isotonic), `param_a`, `param_b` (Platt coefficients; NULL for
  isotonic). Existing rows migrate as sport='nba', method='isotonic'.
- `common.grade_calibration_history`: already has `sport`; add `method`, `brier`,
  `log_loss`, `ece`, `n_corpus`, `gate_passed` columns.

### 2. Calibration core — `grading/calibration_core.py`

Single module used by weekly calibration for every sport.

- `fetch_corpus(engine, sport, window_days)` — the existing tier-line × daily_grades
  join, filtered `sport = :s AND outcome IN ('Won','Lost')` (Push/DNP excluded), UNION
  `common.calibration_corpus` backtest rows for that sport when live rows < 2000
  (seed rows carry `source='backtest'` and are dropped from the union once live corpus
  clears the threshold — live data always supersedes).
- Candidates:
  - identity (raw prob unchanged),
  - Platt: `p' = expit(a·logit(p) + b)` fit by MLE,
  - shrunk isotonic: bucket at 0.05; shrink each bucket hit-rate toward pooled mean by
    `n/(n+K)`, K=50; PAV; evaluate by piecewise-linear interpolation between bucket
    centers (no step edges); clamp to `max_well_sampled_rate` cap as today (n≥30 rule
    unchanged).
- Selection: chronological split (train = oldest window minus 7 days, holdout = latest
  7 days). Score candidates AND the currently-active production calibrator on holdout
  log loss. Publish winner only if `holdout_logloss(winner) <= holdout_logloss(production) - 1e-4`;
  otherwise keep production and log `gate_passed=0`. Identity is always in the pool, so
  the system can never be worse than uncalibrated.
- Metrics: Brier, log loss, ECE (10-bin) computed on holdout for the published
  calibrator, written to `grade_calibration_history` every run regardless of gate.
- Minimum corpus: 300 resolved rows per sport (raised from 100; below it, skip with a
  logged reason — identity behavior implied by absent rows).

### 3. `weekly_calibration.py` rewrite

- Loops sports `['nba','mlb','nfl']` (CLI `--sport` still narrows to one).
- Per sport: fetch corpus → candidate selection → gated publish → metrics snapshot.
- NBA-only logistic `grade_weights` fitting stays as-is (NBA feature set), unchanged.
- `model_performance` write stays NBA-scoped for now (its market map is NBA).
- Workflow `weekly-calibration.yml`: default sport input becomes `all`.

### 4. Readers apply per-sport calibrators

- `grade_props.py`: load calibrator `WHERE sport='nba'`; apply Platt or isotonic-PLI per
  `method`. Identity/absent → passthrough (current behavior).
- `mlb_grade_props.py`: load `sport='mlb'` calibrator, apply to KDE tier probs before
  tier assignment (same insertion point as NBA: post-KDE, pre-EV).
- `nfl_grade_props.py` (new): same, `sport='nfl'`.

### 5. MLB settlement — `run_outcomes` in `mlb_grade_props.py`

- New `--mode outcomes|upcoming` (default upcoming; workflow gains an outcomes step
  before grading, so yesterday settles every morning).
- Set-based UPDATE per market family against final games (`mlb.games.status='F'`):
  batter_rate + batter_count from deduped `mlb.batting_stats` (max-PA row per
  (game, player) — same dedup as the props board), pitcher markets from
  `mlb.pitching_stats`. Stat expressions come from `MARKET_CONFIG['expr']`/at-bats
  definitions — one source of truth.
- Outcome values: `Won`/`Lost`/`Push` (stat == integer line)/`DNP` (game final, player
  absent from boxscore). Calibration + transparency count only Won/Lost.
- NBA `run_outcomes` gains the same `Push` case (integer lines) and `DNP` (game final,
  no boxscore row) — corpus purity fix. Only `outcome IS NULL` rows are touched.

### 6. Backtest seeding — `grading/seed_calibration_corpus.py`

- New table `common.calibration_corpus (sport, grade_date, player_id, market_key,
raw_prob, hit BIT, source VARCHAR(20), created_at)`, PK (sport, grade_date, player_id,
  market_key, raw_prob).
- MLB: replay the KDE tier-line generator over historical `mlb.player_at_bats` /
  `mlb.batting_stats` game logs (2025 + 2026 season dates), leakage-safe (game log
  strictly before grade_date), resolve each generated (line, prob) against the realized
  stat. Emits (raw_prob, hit) pairs — thousands of rows from two seasons.
- NFL: same replay over `nfl.player_game_stats` weekly logs (seasons 2022–2025 after
  backfill; 2025 already loaded).
- One-off manual dispatch workflow `seed-calibration.yml`; delete after it ships per
  workflow rules? No — keep: re-runnable when NFL backfill seasons land (idempotent
  MERGE). Revisit deletion once live corpora clear the 2000-row threshold.

### 7. NFL model — `grading/nfl_grade_props.py`, model `nfl-v1.0`

- Mirrors the MLB shape (MARKET_CONFIG-driven, three families):
  - `qb`: player_pass_yds, player_pass_tds, player_pass_attempts, player_pass_completions
  - `rush`: player_rush_yds, player_rush_attempts
  - `receiving`: player_receptions, player_reception_yds
  - (player_anytime_td deliberately excluded v1.0 — scoring market, own model later.)
- Game logs from `nfl.player_game_stats` (weekly grain). Composite:
  - form 0.40 — weighted per-game stat, L4 0.5 / L8 0.3 / season 0.2;
  - matchup 0.35 — opponent defense: stat allowed per game to the market's position
    group, from `nfl.player_game_stats` joined on opponent, season-to-date, normalized
    against league mean;
  - volume stability 0.25 — snap-share level and variance from `nfl.snap_counts`
    (offense_pct L4 mean, penalized by stdev).
- KDE tier lines: same generator (window sizes in games: hot 8 / mid 12 / cold 17 —
  a season is 17 games, so NBA's 15/30/60 shrinks proportionally), same tier
  probability thresholds, same 0.5-line scan.
- `run_outcomes` vs `nfl.player_game_stats` (Won/Lost/Push/DNP).
- Upcoming mode reads `odds.upcoming_player_props WHERE sport_key='americanfootball_nfl'`
  (FanDuel only). Zero props + no scheduled games = clean exit; zero props WITH scheduled
  in-season games = loud failure (pipeline-truth, same as MLB).
- Workflow `nfl-grading.yml`: cron Thu–Mon 13:00 UTC Sept–Feb (game days), plus
  dispatch. Steps: outcomes → grade. Off-season runs exit clean.
- NFL ETL backfill: dispatch `nfl-etl.yml` for seasons 2022/2023/2024 (input already
  exists) so matchup baselines and the seed corpus have depth.

### 8. Explicitly cut

- Multi-bookmaker odds, NFL anytime-TD/ordering markets, per-market (rather than
  per-sport) calibrators (revisit when per-market corpora clear ~2000 resolved rows),
  weather/park model features (separate backtest-first track), MLB/NFL logistic
  grade_weights (NBA feature set doesn't transfer; revisit with sport-native features).

## Verification plan

- Unit-style: calibration core fit/eval on synthetic data (known miscalibration
  recovered; gate refuses a degraded candidate; PLI monotone).
- MLB outcomes: settle 2026-05-01 rows, cross-check a handful by hand against
  boxscores.
- Seeder: spot-check leakage (no game log row ≥ grade_date), corpus row counts.
- Weekly calibration dry-run per sport on the Mac against the live DB.
- NFL: full dry-run grade of a 2025 week with odds absent (tier lines only) + outcomes
  resolution of that week; composite sanity (elite QB > backup).
- etl-integrity-reviewer + betting-grading-reviewer agents on the diff before merge.
