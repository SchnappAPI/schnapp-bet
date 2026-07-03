# Roadmap

Brief by design. Detailed task tracking lives in component READMEs under "Open Questions" sections.

## Active

- **Restore the Odds API key.** Deactivated (payment/cancellation) since ~2026-04-24; every props-dependent surface is blocked on it. New key goes in `op://web-variables/ODDS_API_KEY/credential`. Pipelines now fail loudly while it is dead (ADR-20260703-1); expect red odds/grading runs until restored.
- **MLB in-season pipeline (2026-07-03 revamp).** PBP scheduled nightly, trend-path bugs fixed, grading widened to 16 markets (`mlb-v1.1`), batter context + projections shipped (ADR-0004 complete), `/mlb/grades` surface. Verify end-to-end once odds flow again.
- **NFL onboarding — grading remains.** Foundation shipped 2026-07-03 (season fix, odds mappings, integrity, `/nfl` page behind `sport.nfl` flag). `nfl_grade_props.py` lands when NFL odds flow (~September); design contract in ADR-20260703-2.

## Next

- **grading-v2 Phases 8–9 decision (NBA).** Backend emits `model_prob`/`ev_pct`/`player_value_lines` daily; the web still renders the composite grade. Ship the web display + historical re-grade, or formally shelve. Then archive `grading-v2/`.
- **MLB grading-v2 parity.** MLB stays composite+KDE (`mlb-v1.1`) by decision; revisit once NBA Phases 8–9 resolve and an MLB resolved-outcomes corpus exists (needs MLB settlement, which does not exist yet).
- **CI foundation.** ruff + pytest + eslint + tsc gating on PRs (see `docs/reviews/2026-07-03-repo-improvement-review.md` for the full backlog).
- **MLB pattern quality monitoring.** Once an MLB equivalent of `common.player_line_patterns` populates.

## On the horizon

- **MLB live path.** statsapi GUMBO feed paralleling the NBA Flask CDN proxy; MLB currently has no live view.
- **Subscription/payment layer.** Stripe is the likely choice. Architecture is scoped but not started. Triggers a passcode model rework since payment-gated access replaces the current passcode-gate.
- **Automated SQL Server backup with restore verification.** Currently only pre-migration BACPACs exist.

## Decisions deferred

- **Multi-bookmaker support.** FanDuel only for now. See `docs/decisions/ADR-20260420-3-fanduel-only.md`.
- **Power Query rule.** No PQ in schnapp-bet today; `.claude/rules/powerquery.md` will be added only if PQ work returns.
