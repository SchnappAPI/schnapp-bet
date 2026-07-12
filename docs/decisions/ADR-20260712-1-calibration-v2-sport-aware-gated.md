# ADR-20260712-1 — Sport-aware gated calibration with backtest-seeded corpora

Date: 2026-07-12
Status: Accepted

## Context

The weekly calibrator had four structural reliability problems, verified against
code and the live DB (design doc:
`docs/superpowers/specs/2026-07-11-calibration-v2-nfl-model-design.md`):

1. `weekly_calibration.py` replaced `common.grade_calibration` unconditionally —
   a thin or skewed week silently degraded production, with no quality gate and
   no recorded metrics.
2. Calibration was sport-blind: the corpus join had no sport filter and
   `grade_calibration` had no sport column (PK = `bucket_min`). It worked only
   because MLB had zero settled outcomes; the moment a second sport settled,
   all sports would pollute one shared calibrator. NFL Odds-API market keys
   share the `player_` prefix with NBA, so market-key prefixes cannot
   discriminate.
3. MLB grades never settled (no `run_outcomes`) and MLB tier probabilities
   never passed through any calibrator.
4. Cold-start: MLB had 204 graded rows (one May 2026 slate), NFL zero — a
   live-only corpus leaves new sports uncalibrated for months.

The owner directive was to make calibration as reliable as possible, not
limited to the existing approach, and to stand up an NFL model + calibration.

## Decision

1. **One calibrator per sport**, stored in `common.grade_calibration` keyed
   `(sport, bucket_min)` with a `method` column. `common.daily_grades` and
   `common.player_tier_lines` gain a `sport` column, backfilled from
   `model_version` (`mlb%` → mlb, `nfl%` → nfl, else nba) — the backfill is
   part of the idempotent `ensure_calibration_schema` and self-heals weekly.
2. **Candidate selection with a holdout gate** (`grading/calibration_core.py`):
   per sport, fit identity / Platt (2-parameter, negative-slope refused) /
   shrunk-isotonic (empirical-Bayes bucket shrinkage n/(n+50), PAV,
   piecewise-linear evaluation), score all candidates AND the active
   production calibrator on a chronological 7-day holdout by log loss, and
   publish the winner only if it beats production by GATE_MARGIN. Identity is
   always in the pool, so calibration can never be worse than uncalibrated on
   the evidence available. Brier / log loss / ECE are snapshotted to
   `common.grade_calibration_history` every run regardless of gate outcome.
3. **Settlement everywhere**: MLB gains `--mode outcomes`
   (Won/Lost/Push/DNP against deduped `mlb.batting_stats` /
   `mlb.pitching_stats`, config-driven stat expressions), wired into
   `mlb-grading.yml` before grading. NBA `run_outcomes` gains Push
   (stat == integer line — previously mis-graded Won for Over) and DNP
   (final game, no box row). Calibration counts Won/Lost only.
4. **Backtest-seeded corpora** (`grading/seed_calibration_corpus.py` +
   `common.calibration_corpus`): the production KDE tier machinery is
   replayed leakage-safely over historical game logs (MLB batting stats;
   NFL weekly stats), and `fetch_corpus` unions the seed only while the
   sport's live corpus is below 2,000 rows. Seed rows train but never judge
   (they are excluded from the holdout).
5. **NFL model `nfl-v1.0`** (`grading/nfl_grade_props.py` + `nfl-grading.yml`):
   MARKET_CONFIG-driven (8 FanDuel markets, qb/rush/receiving families),
   composite = 0.40 form (L4/L8/season) + 0.35 opponent-allowed-vs-league
   matchup + 0.25 snap-share volume, KDE tiers with 8/12/17-game windows,
   sport='nfl' calibrator applied, Won/Lost/Push/DNP settlement. Identity:
   `daily_grades.player_id` stores the numeric suffix of the gsis id
   (`00-0033873` → 33873), reconstructed as `00-{pid:07d}`;
   `resolve-mappings.yml` emits the same encoding.

## Consequences

- The Sunday weekly-calibration run now covers all three sports (workflow
  default `sport=all`) and can only improve or hold production quality; every
  run leaves a metrics trail for the transparency surface.
- MLB grades settle daily, so the MLB live corpus accrues as soon as the
  Odds API key is restored; until both it and NFL clear 2,000 live rows, their
  calibrators rest on the backtest seed.
- `grading/calibration_core.py` is the single home of calibrator math;
  `grade_props.py`, `mlb_grade_props.py`, `nfl_grade_props.py` all load and
  apply through it. The old inline bucket-reading code in `grade_props.py` is
  gone.
- New outcome values Push/DNP flow into `common.daily_grades.outcome`; all
  existing consumers filter `IN ('Won','Lost')` or compare `= 'Won'` and are
  unaffected.
- Follow-ups: NFL 2022–2024 season backfills dispatched (nfl-etl); per-market
  calibrators become worth revisiting when a sport's per-market corpus clears
  ~2,000 resolved rows; MLB/NFL logistic grade-weight analogs need
  sport-native features.

## Out of scope

- Multi-bookmaker odds; NFL anytime-TD and other ordering/scoring markets;
  weather/park model features (separate backtest-first track); replacing the
  NBA logistic grade-weights layer, which stays NBA-only as-is.
