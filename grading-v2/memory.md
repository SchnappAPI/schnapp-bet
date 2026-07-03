# Grading System v2 — Memory

This file captures corrections, learned facts, and invariants discovered during the build.
Every session must read this before starting work. Every correction from the user gets saved here.
Do not make the same mistake twice.

---

## Repo and infrastructure facts

- Python runs only in GitHub Actions (mac-runner). Never suggest running Python locally on the corporate machine (ThreatLocker blocks it).
- All DB writes go to local SQL Server 2022 on Schnapps-MBP (Docker/Colima, localhost:1433). Azure is fully decommissioned.
- ETL env vars: SQL_SERVER, SQL_DATABASE, SQL_USERNAME, SQL_PASSWORD, SQL_TRUST_CERT. Not AZURE_SQL_*.
- Python venv: `/Users/schnapp/venv`. PYTHONPATH must be set to `/Users/schnapp/code/schnapp-bet` in all mac-runner workflows. (Updated 2026-07-03; the pre-cutover `/Users/schnapp/sports-modeling` path is retired.)
- `create_or_update_file` requires a fresh SHA fetched immediately before the call. Never use a SHA from earlier in the session — it may be stale after a prior commit.
- Never use `push_files` for .py files (corrupts newlines). Always use `create_or_update_file`.
- Never use `push_files` for TSX with non-ASCII Unicode. Safe only for strict-ASCII TypeScript, JSON, YAML.
- Shared DB utility is `shared/db.py` (not `etl/db.py` — that was deleted 2026-05-03).
- Shared integrity is `shared/integrity.py`.

---

## Grading system facts

- `common.daily_grades` UNIQUE key: `(grade_date, event_id, player_id, market_key, bookmaker_key, line_value, outcome_name)`
- `_common_grade_data` returns an **8-tuple**: `(history_df, season_df, opp_info, matchup_cache, opp_history_df, patterns, opp_df, role_context)`. Never revert to 5-, 6-, or 7-tuple.
- `grade_props_for_date()` returns a **3-tuple**: `(grade_rows, tier_rows, value_rows)`. tier_rows is always empty post-Phase 6 (KDE replaced). value_rows are the new per-line EV output.
- `common.player_value_lines` UNIQUE key: `(grade_date, game_id, player_id, market_key, line_value)`. One row per positive-EV Over line. Expects active grade_weights to produce non-NULL ev_pct — 0 rows emitted when corpus is empty.
- `precompute_line_grades` iterates by `(player_id, market_key)` pair, fans out across line values in inner loop.
- `weighted_hit_rate` is stored as 0.0–1.0 (not 0–100). Multiply by 100 for display.
- Composite grade columns stay in DB for historical rows but are no longer computed for new rows after v2 ships.
- MODEL_VERSION: current value is `grading-v2.0` (bumped in Phase 6).
- `validate_and_filter` from `shared/integrity.py` must wrap all write paths. IDENTITY columns (grade_id, tier_id) must NOT be in `always_required` — this was a prior bug.
- Grading bug fixed 2026-05-02: `opportunity_streak_epoch` typo in MERGE was `opportunity_streak_grade`. Never reintroduce.

---

## Outcome resolution facts

- Old rule: stat > line = Won for Over, stat < line = Won for Under. Pushes called Lost.
- **New rule (v2)**: stat >= line = Won for Over, stat <= line = Won for Under. Exact hits count as wins.
- DNP players (no box score row) stay NULL indefinitely. This is expected behavior, not a bug.

---

## Calibration facts

- `weekly_calibration.py` is the only writer of `common.grade_calibration`. Daily grading only reads it.
- KDE calibrator survives in v2 but only for tier line probability calibration. Composite grade calibration moves to logistic layer.
- WELL_SAMPLED_THRESHOLD = 30 for the KDE cap. Keep this.
- Calibration window: 30 days currently. Adaptive minimum-sample approach (500 floor / 1500 target) deferred to next session.
- `common.model_performance` UNIQUE key: `(snapshot_date, market_group)`. Three rows per calibration run: Volume / Rate / Counting. Written by `write_model_performance()` in weekly_calibration.py after `fit_logistic_models`. Idempotent DELETE+INSERT. ev_pct/model_prob NULLs handled gracefully (avg_ev_pct=NULL, pws=0.0, corr=NULL when insufficient data). Phase 8 (web display) reads this table.

---

## Display facts

- `weighted_hit_rate` multiply by 100 before displaying as a percentage. This has caused bugs before.
- EV% formula: `(model_prob × payout - (1 - model_prob)) × 100` where payout = price/100 (positive) or 100/abs(price) (negative).
- Color coding: EV% > 8% green, 0–8% yellow, < 0% gray.
- Composite grade removed from display entirely. Column stays in DB.

---

## Corrections from user

- 2026-05-05: Exact hits on whole-number lines count as Won, not a push or Lost. This applies to both Over and Under.
- 2026-05-05: Context penalty / role compression should NOT suppress or penalize the model. It should weight recent relevant games more heavily — not exclude or discount anything.
- 2026-05-05: Usage rate table needs to be added to the DB. Pull from NBA Stats API boxscoretraditionalv3 (already called for box scores).
- 2026-05-05: Do not offer option lists. Make a recommendation and proceed. Act as an expert.
- 2026-05-05: Build as a clean replacement that goes live all at once, not incrementally.
- 2026-05-05: Never rewrite historical grades. New grades get new columns. Old composite grade stays for comparison.

---

## API key (do not log values here — log only metadata)

- ANTHROPIC_API_KEY: was exposed in chat 2026-05-05. RESOLVED — rotated (owner confirmed 2026-07-03).
- CLAUDE_CODE_OAUTH_TOKEN: was exposed in a prior chat transcript. RESOLVED — rotated (owner confirmed 2026-07-03).
