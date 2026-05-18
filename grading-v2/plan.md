# Grading System v2 — Project Plan

## Status: IN PROGRESS
## Started: 2026-05-05
## Target: Complete this session

---

## What this project is

A full replacement of the NBA prop grading and calibration system. The old system computed a composite grade (0–100) using fixed weights. The new system outputs two numbers per prop:

- **Model Prob**: the model's calibrated probability that the player's stat clears the line, derived from a relevance-weighted sample and a fitted logistic model
- **EV%**: expected return per dollar staked, computed from Model Prob vs implied probability from the posted price

The redesign affects grading, calibration, ETL, and the web display. Historical grade rows are never rewritten.

---

## Design decisions (locked)

- Exact hits count as Won: stat >= line for Over, stat <= line for Under
- Composite grade removed from display; column stays in DB for historical comparison
- Historical grades preserved for model comparison via `common.model_performance`
- Build as a clean replacement, goes live all at once
- Flat $1 stake for backtest profit-weighted scoring
- Market groups: Volume (PTS/PRA/PR/PA/RA), Rate (3PM/STL/BLK), Counting (REB/AST)
- KDE tier lines replaced by EV%-based value lines (neg binomial / normal dist)
- Relevance weighting: recency decay × role similarity (minutes) × context weight
- Role similarity uses minutes now; usage_pct added once data accumulates
- Calibration holdout: chronological, train days 1–30, holdout days 31–37
- Profit-weighted backtest: flat $1 stake, sum(ev_pct) where model_prob > implied_prob
- Pushes: stat == line = Won
- Deferred: usage rate weighting, margin-based momentum, trajectory shape, regime detection, expanded view UI

---

## Phases

### Phase 1: Usage rate ETL and player_usage_stats table
**Status: COMPLETE** (commit ddb7318)
- `etl/nba_etl.py`: `_parse_iso_minutes()`, `_parse_advanced_boxscore()`, `load_player_usage_stats()`
- DDL: `nba.player_usage_stats` (game_id, player_id, usage_pct, est_usage_pct, pace, possessions)
- ETL triggered 2026-05-05, backfilling in progress (10 game dates per run)

### Phase 2: Relevance-weighted hit rate
**Status: COMPLETE** (commit e857766)
- `grading/grade_props.py`: RECENCY_DECAY/ROLE_SIGMA_MIN/CTX_* constants
- `fetch_player_role_context()`: current role minutes + volatility per player
- `_relevance_weight()`: recency × role_similarity × context per game
- `compute_relevance_weighted_hit_rate()`: weighted proportion + effective_n
- `compute_all_hit_rates()`: adds relevance_hit_rate, effective_n, role_minutes_current, role_volatility
- `fetch_history()`: now fetches season_type and game_minutes
- `_common_grade_data()`: returns 8-tuple (added role_context)
- `upsert_grades()`: 4 new columns in stage/MERGE
- `ensure_tables()`: 4 new columns on common.daily_grades

### Phase 3: Logistic model fitting and grade_weights table
**Status: COMPLETE** (commits faef8e6, 1cf415b, 1e6fe78)
- `grading/weekly_calibration.py`: MARKET_GROUP_MAP, LOGISTIC_FEATURE_NAMES, ensure_grade_weights_table(), fetch_grade_corpus(), assemble_features(), _fit_logistic(), write_grade_weights(), fit_logistic_models()
- `common.grade_weights` created on first run (is_active flag, atomic deactivate-old + insert-new)
- get_engine() bug fixed: now reads SQL_TRUST_CERT from env (was hardcoded `no`)
- Logistic fitting guarded in try/except so isotonic path can't be broken by schema/data gaps
- Logistic corpus will be empty until resolved Phase 2 grades accumulate (expected — model trains on data graded after Phase 2)
- Note: `grading/grade_props.py` does NOT yet read grade_weights — that is Phase 5

### Phase 4: Shadow backtest in calibration
**Status: COMPLETE** (commit 12e36fc)
Files: `grading/weekly_calibration.py`
- Train days 1–30, holdout days 31–37 (chronological); total 37-day corpus
- `_implied_prob()`: vectorized American odds → implied probability
- `score_holdout()`: inline feature engineering + model_prob → ev_pct; returns (score, n)
- `get_production_score()`: loads active grade_weights, scores same holdout; 0.0 on first run
- `ensure_calibration_log_table()` / `write_calibration_log()`: common.calibration_history DDL + upsert
- `write_grade_weights()` extended: now accepts holdout_score, production_score kwargs
- `fit_logistic_models()` rewritten: train/holdout split, champion/challenger gate, always logs
- main() try/except tightened to log.error + raise (failures now visible in CI)

### Phase 5: Model Prob, EV%, outcome resolution fix
**Status: COMPLETE** (commit 6b25ec6)
Files: `grading/grade_props.py`
- `load_grade_weights(engine)`: reads active rows from common.grade_weights, returns dict[group → (coef, intercept)]
- LOGISTIC_FEATURE_NAMES / LOGISTIC_MARKET_GROUP_MAP / shrinkage constants added
- `grade_props_for_date()`: calls load_grade_weights() before row loop; computes model_prob/implied_prob/ev_pct inline
- `ensure_tables()`: ADD-COLUMN guard for model_prob, implied_prob, ev_pct FLOAT
- `upsert_grades()`: #stage_grades DDL (38 cols), INSERT (38 ?), MERGE UPDATE+INSERT
- Outcome resolution: >= for Over Won, <= for Under Won (exact hits count)
- opp_ratio_minutes uses neutral fallback 1.0 (not yet stored in daily_grades)

### Phase 6: KDE tier lines replacement
**Status: COMPLETE** (commit 281c6f2)
Files: `grading/grade_props.py`
- New table `common.player_value_lines`: one row per (grade_date, game_id, player_id, market_key, line_value) where ev_pct > 0
- `upsert_value_lines()`: temp-table + batch INSERT + MERGE on 5-column unique key
- `grade_props_for_date()`: post-loop pass indexes positive-EV Over grade_rows by (player_id, market_key, game_id); emits one value row per line with opportunity context + hit stats
- `run_upcoming/run_intraday/run_backfill`: unpack 3-tuple, validate + upsert value_rows
- backfill force=True skip clause updated to check player_value_lines
- MODEL_VERSION bumped to "grading-v2.0"
- compute_kde_tier_lines() preserved (MLB uses it); tier_rows now always empty

### Phase 7: Model performance comparison table
**Status: COMPLETE** (commit ac89456)
Files: `grading/weekly_calibration.py`
- DDL: `common.model_performance` (snapshot_date, model_version, market_group, n_resolved, hit_rate, avg_ev_pct, profit_weighted_score, composite_grade_correlation)
- Written on each weekly calibration run

### Phase 8: Web display
**Status: NOT STARTED**
Files:
- `web/lib/queries.ts` — select model_prob, implied_prob, ev_pct
- `web/app/api/grades/route.ts` — return new fields
- `web/components/GameTabs.tsx` — PropsTab: Model Prob + EV% columns
- `web/app/nba/[atAGlanceComponent]` — replace composite grade
- `web/components/GameTabs.tsx` — SupplementalTab: sort by EV%
Color: EV% > 8% green, 0–8% yellow, <0 gray

### Phase 9: Re-run today's grading
**Status: NOT STARTED**
Action: trigger refresh-data after Phase 8 deploys

---

## Files changed this project (running list)

| File | Phases | Status |
|---|---|---|
| `etl/nba_etl.py` | 1 | COMPLETE |
| `grading/grade_props.py` | 2,3,5,6 | COMPLETE |
| `grading/weekly_calibration.py` | 3,4,7 | Phases 3,4 complete, 7 pending |
| `web/lib/queries.ts` | 8 | NOT STARTED |
| `web/app/api/grades/route.ts` | 8 | NOT STARTED |
| `web/components/GameTabs.tsx` | 8 | NOT STARTED |

---

## Deferred to next session

- Usage rate as role similarity weight (data accumulating)
- Margin-based momentum and trajectory shape labels
- Opponent-specific pattern with shrinkage
- Regime detection in calibration window
- Expanded view component breakdown UI
- Adaptive calibration window minimum-sample approach

---

## How to use this folder

On session start:
1. Read `grading-v2/plan.md`
2. Read `grading-v2/memory.md`
3. Read latest file in `grading-v2/handoffs/`
4. Resume at first phase NOT STARTED or IN PROGRESS

On session end:
1. Update phase statuses in this file
2. Update Files changed table
3. Write handoff to `grading-v2/handoffs/YYYY-MM-DD-HH.md`
4. Save corrections to `memory.md`
