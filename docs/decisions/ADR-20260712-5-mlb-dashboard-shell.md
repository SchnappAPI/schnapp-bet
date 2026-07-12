# ADR-20260712-5 — Universal MLB dashboard shell (persistent shared filter bar)

Date: 2026-07-12
Status: Accepted

## Context

The MLB section grew into seven independent screens — games (`/mlb`), live,
at-a-glance/grades, research, props, streaks, transparency — each managing its
own filter state. Two patterns had accreted: some boards read URL `searchParams`
(games, research), others local `useState` (props, streaks, transparency,
grades). Market and date selectors were reimplemented inline in four boards; no
board could be filtered by game/matchup; and switching screens threw away
whatever filters were set.

Owner intent (verbatim): "I want these all to be filterable by game as well… a
more universal MLB dash so I can easily and quickly toggle through all these
screens using the same set of filters." The trends/patterns view (`/mlb/streaks`)
stays first-class.

## Decision

One persistent filter bar (GAME / MARKET / DATE) shared across all `/mlb/*`
routes, backed by a React context in a Next.js nested layout.

1. **Shell = `web/app/mlb/layout.tsx`.** Next nested layouts do not remount on a
   child-route change, so a bar rendered in the layout stays mounted while the
   board below swaps. That is the persistence mechanism — no cross-route param
   threading needed.

2. **State = `MlbFilterProvider` context** (`web/components/mlb/`) holding
   `{date, market, game}`:
   - `market` → mirrored to `localStorage` (`sb.mlb.market`); durable across
     sessions. Canonical set is `HR | HRR | HITS`; each board maps it to its own
     market vocabulary and falls back to its default when there is no equivalent.
   - `date` → default latest/today; session-only (a stale date must not survive
     to tomorrow).
   - `game` → a matchup chosen from the day's slate (`/api/mlb/research/slate`),
     default "All games", session-only. On any date change the selection is
     revalidated against the new slate and falls back to All if absent.

3. **Game → screen mapping.** Client-side `teamAbbr` match on props/streaks
   (no API change — both already return `teamAbbr`); native `gamePk` on
   research/live. Per-screen applicability (`applicabilityForPath` in
   `web/lib/mlbFilters.ts`) is **disable-not-hide**: filters that do not apply to
   the current screen render dimmed and inert so the bar stays visually stable.
   props/streaks/grades = all three; research = game+date; transparency = market
   only; live = game only; `/mlb` = game (scroll-to-card) + date.

4. **No new APIs, no schema changes, no URL-param sync in v1.** Every filter is
   satisfied by client-side filtering or existing route params (`date`,
   `gamePk`). Shareable/bookmarkable URLs were deliberately deferred — a
   single-user dash gains little, and the context is additive to layer it on
   later without touching consumers.

## Alternatives rejected

- **URL-param sync as the source of truth.** Would make any view shareable, but
  separate routes do not carry params across a sidebar navigation without either
  a param-threading sidebar or a provider anyway — so the provider is required
  regardless, and the URL layer is pure extra surface for a single user. Deferred.
- **Team-sticky game filter** (pick a team once, it follows you day to day).
  More useful for someone who follows specific teams; the owner chose
  matchup-resets-daily as the simpler default.

## Consequences

- Boards were refactored to read `useMlbFilters()` and drop their duplicated
  market/date/game controls (single source of truth for filters).
- The streaks board keeps a render-time-derived market (context family + a local
  `HRR2`/`HRR3` sub-choice the single shared "HRR" pill cannot express); RBI is
  now reachable only in the per-player streak drill-down.
- The props board surfaces a note when the API's resolved slice differs from the
  selected date (the API falls back to the latest slice when today's is not yet
  written) so the shared date pill never silently mislabels the data shown.
- `/mlb/grades` is wired but remains dark (Odds API dead, Issue #8); it keeps an
  independent batter/pitcher category control alongside the shared market.
- Adding a new `/mlb/*` screen now means: add a row to `applicabilityForPath`
  and read `useMlbFilters()` — the bar and persistence come for free.

First applied by the commits on branch `claude/friendly-curie-90239d`
(shell + provider + bar, then per-board wiring).
