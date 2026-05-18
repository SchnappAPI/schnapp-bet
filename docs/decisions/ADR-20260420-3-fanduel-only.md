# ADR-20260420-3: FanDuel-only bookmaker across all sports

Date: 2026-04-20

Legacy ID: ADR-0007.

## Context

The Odds API supports a dozen US bookmakers. Early ingestion pulled multiple books for price comparison. In practice FanDuel has the most complete prop line coverage in the markets we grade (player points, rebounds, assists, combos, alternates). Non-FanDuel rows complicated the grading join because line offerings and line values differed per book, and the web always displays the FanDuel price in betslip links regardless. Carrying non-FanDuel rows added storage and grading noise without changing any user-facing decision.

## Decision

All NBA and MLB odds ingestion uses `bookmakers=fanduel`. No other bookmakers are written to `odds.*` tables. This applies to both upcoming and historical modes. Betslip deep links use FanDuel's event link format via `includeLinks=true` on the per-event Odds API endpoint.

## Consequences

- `odds.upcoming_player_props.bookmaker_key` is effectively a constant (`'fanduel'`). Queries can elide it but must still match on the column to preserve future-proofing.
- Reopening to additional bookmakers is possible later but would require downstream grading and web changes to pick a displayed price. Not trivially reversible.
- Odds API credit consumption is minimized by not pulling additional bookmakers we would discard.
- Enforced as an invariant in `.claude/rules/etl.md` and `.claude/rules/database.md` (`bookmaker_key = 'fanduel'` invariant on odds-schema writes).
