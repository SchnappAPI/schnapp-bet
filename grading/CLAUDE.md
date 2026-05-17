# grading/CLAUDE.md

Grading engine scripts that read from ETL tables and write grade rows to common.daily_grades
and related tables. All runs via GitHub Actions on mac-runner.

## Scripts

- `grade_props.py` — NBA grading. Modes: upcoming, intraday, backfill, outcomes.
- `mlb_grade_props.py` — MLB grading.
- `weekly_calibration.py` — logistic model fitting and weight updates. Runs Sundays 06:00 UTC.
- `generate_supplemental.py` — writes per-game supplemental JSON to common.game_supplemental.

## Invariants — do not change without an ADR

- `_common_grade_data` returns a 7-tuple. The seventh element is `opp_df`. Never revert to
  5-tuple or 6-tuple. All callers must unpack all seven elements.
- `precompute_line_grades` iterates by `(player_id, market_key)` pair, not per line value.
- `fast_executemany=False` on the grading engine connection only. This prevents NVARCHAR(MAX)
  truncation. Callers must pass `fast_executemany=False` explicitly when building their engine.
- `common.daily_grades` has `outcome_name` (Over/Under) and `over_price` (INT). The UNIQUE
  key includes `outcome_name`. grade_props.py writes both Over and Under rows.
- `MODEL_VERSION` must be set in every grading script. NBA: `grading-v2.0`. MLB: `mlb-v1.0`.
  Bump on any change to grading logic that would invalidate historical predictions.

## Rules

- Import `get_engine` from `shared.db`. Call it with `fast_executemany=False`.
- Import `validate_and_filter` from `shared.integrity` and wire it before every write to
  `common.daily_grades` and `common.player_tier_lines`.
- `record_workflow_run()` must be the last call in upcoming/intraday/outcomes modes. Skip it
  in backfill mode (backfill does not update the UI freshness timestamp).
- Do not re-grade rows that already exist unless `force=True` is explicitly passed. Backfill
  skip check is: `NOT EXISTS (SELECT 1 FROM common.daily_grades WHERE grade_date = @date
  AND model_version = @model_version)`.
- Calibrator: n >= 30 threshold for well-sampled bucket qualification. Do not lower this.
- KDE thin-sample cap: `KDE_THIN_SAMPLE_PROB_CAP = 0.85`. Do not remove.
- Logistic model fitting: minimum 50 resolved outcomes per market group. Groups below
  threshold are skipped with a warning, not an error.
