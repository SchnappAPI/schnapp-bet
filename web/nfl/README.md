# NFL Web

**STATUS:** foundation live (2026-07-03), gated behind the `sport.nfl` feature flag (ComingSoon renders while the flag is off). See ADR-20260703-2.

## Purpose

Implements the product blueprint for football on the weekly grain (week picker, not date picker).

## Files

- `/web/app/nfl/page.tsx` — server shell; flag gate + Suspense (follows the `/mlb` pattern)
- `/web/app/nfl/NflPageInner.tsx` — season + REG/POST + week picker, game cards grouped by day (scores for played games, spread/total for upcoming), position-tabbed player-stats table with team filter
- `/web/app/api/nfl/games/route.ts` — week slate. Playoff `game_type` values (WC/DIV/CON/SB) collapse to `season_type='POST'` to match `nfl.player_game_stats`
- `/web/app/api/nfl/player-stats/route.ts` — per-week QB/RB/WR-TE stat lines ordered by PPR points

Routes use the nested `/api/nfl/*` convention (NBA-style), not flat `nfl-*`. Next deliverables: per-game detail page, player pages, and props/grades surfaces once NFL odds + grading exist.

## Invariants

Inherited cross-sport patterns:

- URL is the source of truth for selected week and game
- No shared components with NBA or MLB until a proven need for sharing exists; start isolated, refactor later
- All visual stats come from pre-aggregated tables (ADR-0004). The 7 `nfl.*` tables should largely satisfy this at launch; FTN charting in particular is already play-level and pre-aggregated to per-play rows

## Recent Changes

Git log is the changelog (ADR-20260517-4): `git log --grep='\[nfl\]' --grep='\[web\]'`.

## Open Questions

- Whether to land a per-game detail page next or go straight to player pages, given the weekly grain (the week slate + player stats shipped 2026-07-03; week picker question settled — season + REG/POST + week selector)
- Whether NFL props need the same "At a Glance" matrix that NBA has, given how few props FanDuel posts per player per week
- (settled 2026-07-03) Props import via `odds_etl.py` extensions — `_run_mappings_nfl` + the existing NFL market definitions; no separate `nfl_odds_etl.py`
