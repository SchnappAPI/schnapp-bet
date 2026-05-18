# ADR-20260505-1: Replace KDE tier lines with EV%-based player_value_lines (NBA)

Date: 2026-05-05

## Context

Prior to grading-v2, `common.player_tier_lines` stored one wide row per (player, market, game) with four fixed-tier columns: Safe (P≥80%), Value (P≥58%), HighRisk (P≥28%, price≥+150), Lotto (P≥7%, price≥+400). Probabilities came from a KDE fitted on historical stat values. Phase 5 of grading-v2 introduced a logistic model that already produces `model_prob` and `ev_pct` for each posted alternate line in `common.daily_grades`. The KDE approach became a separate, redundant probability computation for a different output shape.

## Decision

Replace the KDE tier system with a per-line EV%-based table for NBA:

1. New table `common.player_value_lines` with unique key `(grade_date, game_id, player_id, market_key, line_value)` — one row per positive-EV Over alternate line.
2. Probabilities sourced from the Phase 5 logistic `model_prob` already computed in grade rows (no separate distribution fit).
3. Rows emitted only where `ev_pct > 0`; opportunity context (minutes, opportunity) and raw hit stats attached per row.
4. `compute_kde_tier_lines()` preserved — MLB grading still uses it.
5. `MODEL_VERSION` bumped to `"grading-v2.0"`.

## Rejected alternatives

- Neg-binomial / normal parametric fit per market: complexity with no benefit since logistic `model_prob` already conditions on player features beyond raw stat distribution.
- Keep 4-tier schema and fill with EV%-selected lines: preserves wide format but Phase 8 web display wants to sort by `ev_pct`, which is cleaner with per-line rows.
- Per-line rows in the existing `player_tier_lines`: would require changing the unique constraint and migrating existing rows; new table is cleaner.

## Consequences

- `player_tier_lines` receives no new NBA rows post-Phase 6; historical rows remain. MLB continues writing.
- `player_value_lines` will be empty until the logistic model accumulates a resolved-grade corpus (~2 weeks of games from Phase 2 launch).
- Phase 8 web display queries `player_value_lines` sorted by `ev_pct DESC`.
- `MODEL_VERSION = "grading-v2.0"` for NBA, `"mlb-v1.0"` for MLB. The version flag invalidates historical predictions on bump.
