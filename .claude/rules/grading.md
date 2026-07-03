---
paths:
  - "grading/**/*.py"
  - ".github/workflows/grading.yml"
  - ".github/workflows/mlb-grading.yml"
  - ".github/workflows/weekly-calibration.yml"
  - ".github/workflows/compute-patterns*.yml"
---

- `_common_grade_data` returns a 7-tuple. Seventh element is `opp_df`. Never revert to 5 or 6 elements. All callers unpack all seven.
- `precompute_line_grades` iterates by `(player_id, market_key)` pair. Not per line value.
- Call `get_engine` with `fast_executemany=False` on grading connections only. Prevents NVARCHAR(MAX) truncation.
- Wire `validate_and_filter` before every write to `common.daily_grades` and `common.player_tier_lines`.
- `record_workflow_run()` is the last call in upcoming/intraday/outcomes modes. Skip in backfill mode.
- Do not re-grade existing rows unless `force=True` is explicitly passed.
- `KDE_THIN_SAMPLE_PROB_CAP = 0.85`. Do not remove.
- Calibrator: n >= 30 for well-sampled bucket qualification. Do not lower.
- Logistic fitting: minimum 50 resolved outcomes per market group. Skip with warning if below threshold.
- `MODEL_VERSION` must be set. NBA: `grading-v2.0`. MLB: `mlb-v1.1` (v1.0 = original 4 markets; v1.1 widened to 16). Bump on any logic change that invalidates historical predictions.
- MLB market families live in `MARKET_CONFIG` (`batter_rate` / `batter_count` / `pitcher`). New markets are added there, never as ad-hoc branches in the grading loop.
