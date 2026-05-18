# Roadmap

Brief by design. Detailed task tracking lives in component READMEs under "Open Questions" sections.

## Active

- **Scaffolding milestone (2026-05-17)**: structure-and-scaffolding rebuild from sports-modeling. `.claude/` complete, `docs/` shaped, per-component CLAUDE.md pointers in place. No code yet. See `docs/decisions/ADR-20260517-2-scaffolding-milestone.md`.
- **Next milestone — code port**: shared/db.py + shared/integrity.py first; then etl/odds_etl.py to verify the FanDuel rule fires; then services/flask/runner.py; then NBA pipeline; then web scaffold; then MLB; NFL last; workflows alongside their code.

## On the horizon

- **MLB pattern quality monitoring**. Once MLB grading is live and the MLB equivalent of `common.player_line_patterns` populates, NBA-style monitoring should follow.
- **Subscription/payment layer**. Stripe is the likely choice. Architecture is scoped but not started. Triggers a passcode model rework since payment-gated access replaces the current passcode-gate.
- **NFL web surface**. ETL pipeline exists in reference repo but no web layer.
- **NFL odds ingestion**. `odds_etl.py` reportedly mentions NFL sport keys but has not been verified. Decide whether to extend it or add a dedicated `nfl_odds_etl.py`.

## Decisions deferred

- **Multi-bookmaker support**. FanDuel only for now. See `docs/decisions/ADR-20260420-3-fanduel-only.md`.
- **Power Query rule**. No PQ in schnapp-bet today; `.claude/rules/powerquery.md` will be added only if PQ work returns.
