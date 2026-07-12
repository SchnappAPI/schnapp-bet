# MLB Universal Dashboard Shell — Design

Date: 2026-07-12
Status: approved (owner brainstorm 2026-07-12)

## Goal

One persistent filter bar shared across ALL MLB views so the owner can toggle
between screens without re-applying filters. Owner (verbatim): "I want these all
to be filterable by game as well… a more universal MLB dash so I can easily and
quickly toggle through all these screens using the same set of filters." The
trends/patterns view (`/mlb/streaks`) stays a first-class section.

Shared filter set:

1. **GAME** — a matchup from the day's slate (default "All games").
2. **MARKET** — HR / HRR / HITS etc (per-screen market vocab differs).
3. **DATE** — prev/next slate nav.

Filter state must persist as the owner switches views.

## Current state (verified 2026-07-12)

- No shared state. Each board manages its own filters independently.
- Two patterns coexist: URL `searchParams` (`/mlb`, `/mlb/research`) vs local
  `useState` (props, streaks, transparency, grades).
- `/mlb/props` (`MlbPropsBoard`) already has a market selector + date-nav (local
  state). Rows carry `teamId` + `teamAbbr`. No game filter.
- `/mlb/streaks` (`MlbStreaksBoard`) has market only, no date nav. Rows carry
  `teamAbbr`. API already accepts `?date=` (unused by the board).
- `/mlb/transparency` is a multi-day tier-hit-rate matrix — no date/game axis,
  market only. API accepts no params.
- `/mlb/research` is the richest: URL-param driven, game via `gamePk` native.
- `/mlb/grades` is DARK (Odds API key dead, Issue #8) — page returns ComingSoon.
- Slate source: `GET /api/mlb/research/slate?date=` → `SlateGame[]` (exported at
  `app/api/mlb/research/slate/route.ts`), carrying `gamePk`, `gameDisplay`,
  away/home team id + abbr + probables. This is the game-dropdown source.
- No MLB API accepts a `team`/matchup param except `research/grid` (`gamePk`).
  MARKET is never a server param — always filtered client-side.

## Architecture

### Shell: `web/app/mlb/layout.tsx` (new)

Next.js nested layouts do not remount when a child route changes. A filter bar
rendered in `mlb/layout.tsx` stays mounted while the board below swaps — this IS
the persistent shell. Sidebar links are unchanged (they just navigate; the
layout persists).

```
app/mlb/layout.tsx           <- client boundary; renders <MlbFilterProvider>
  └─ <MlbFilterProvider>     <- context, owns {date, market, game}
       ├─ <MlbFilterBar>     <- the persistent bar (game / market / date)
       └─ {children}         <- the active board reads context
```

### State: `MlbFilterProvider` (React context)

Holds `{ date, market, game }` plus setters. Survives view-switches because the
provider lives in the persistent layout (no remount on navigation).

- **market** → mirrored to `localStorage` (`sb.mlb.market`). Durable preference
  across sessions. Default `HR`.
- **date** → default = latest/today slate; session-only (a stale date should not
  survive to tomorrow). Bar prev/next mutates it.
- **game** → `{ gamePk, awayAbbr, homeAbbr, label } | null` (null = All games).
  Session-only: gamePk changes daily, so on any date change the selection is
  revalidated against the new slate and falls back to All if absent.

No URL-param sync in v1 (single-user dash, low shareability value; can layer on
later without touching consumers).

Market vocab differs per screen (streaks has HRR2/HRR3/RBI; props has HR/HRR/
HITS; transparency HR/HRR/HITS). The context stores a canonical market; each
board maps context.market → its own local vocab, falling back to its default
when the context market has no equivalent. Keep it lean: a small per-board
`marketFromContext()` mapper, not a platform-wide market taxonomy.

### Game → screen mapping

The bar is always visible in the same position. Filters that do not apply to the
current screen are **disabled (dimmed), not hidden** — the shell stays stable and
the disabled control silently communicates "no effect here".

| Screen       | game     | market   | date     | How game maps                                                                                          |
| ------------ | -------- | -------- | -------- | ------------------------------------------------------------------------------------------------------ |
| props        | ✓        | ✓        | ✓        | client-filter rows where `teamAbbr ∈ {awayAbbr, homeAbbr}`. No API change.                             |
| streaks      | ✓        | ✓        | ✓        | pass context `date` to existing `?date=`; client-filter rows on `teamAbbr`.                            |
| research     | ✓        | disabled | ✓        | context `game.gamePk` drives the existing grid; null = board's first-game default.                     |
| transparency | disabled | ✓        | disabled | aggregate matrix — game/date have no axis; market selects the pane.                                    |
| games (/mlb) | ✓        | disabled | ✓        | date is native; selecting a game in the bar scrolls/highlights that card.                              |
| live         | ✓        | disabled | today    | game applies (board already has game chips); date pinned to today.                                     |
| grades       | (✓)      | (✓)      | (✓)      | DARK. Wire the shell; page stays ComingSoon. Internals already support all three for when odds return. |

### Which screen decides the active market/date on entry

The bar reflects context, not the board. When the owner opens a screen where a
filter is disabled (e.g. market on research), the value is retained in context
(not reset) so it is still active when they switch back to a screen that uses it.

## Components (new, under `web/components/mlb/`)

- `MlbFilterProvider.tsx` — context + localStorage persistence + slate fetch for
  the game dropdown (reuses `/api/mlb/research/slate?date=`).
- `MlbFilterBar.tsx` — the three controls. Each accepts an `applies` prop; when
  false the control renders disabled/dimmed. Extracts the prev/next date-nav and
  market-pill patterns currently duplicated inline in 4 boards.
- `useMlbFilters()` — hook returning context value; throws if used outside the
  provider (catches a board mounted without the layout).

Boards are refactored to read `useMlbFilters()` instead of their own local
market/date state. Their existing inline market/date UI is removed (now in the
bar). Board-local UI that is NOT a shared filter (research hand/abNum slicers,
props conviction toggle, streaks per-player detail) stays on the board.

## Data flow

```
MlbFilterProvider
  fetch /api/mlb/research/slate?date={date}  -> games[] for the dropdown
  context = { date, market, game }
      │
      ├─ props board:   fetch /api/mlb-props?date={date}
      │                   client rows.filter(teamAbbr ∈ game) ; market client-side
      ├─ streaks board: fetch /api/mlb-streaks?date={date}
      │                   client rows.filter(teamAbbr ∈ game) ; market client-side
      ├─ research board: game.gamePk -> existing grid fetch
      └─ transparency:  market only (game/date disabled)
```

No new API endpoints. No schema changes. The only API touch is opportunistic:
none required for v1 (props/streaks already return `teamAbbr`; both APIs already
accept `date`).

## Error handling / edge cases

- **Empty slate** (no games loaded for the date): game dropdown shows only "All
  games"; game filter is a no-op. Never blank the board.
- **Date change orphans the selected game**: revalidate `game.gamePk` against the
  new slate; fall back to null (All).
- **Board mounted without provider**: `useMlbFilters()` throws a clear error —
  caught in dev, never ships (all /mlb pages are under the layout).
- **Market with no board equivalent**: board falls back to its own default and
  the bar still shows the canonical market (retained for other screens).
- **localStorage unavailable** (SSR / privacy mode): guard reads/writes; default
  to `HR`.

## Feature gating

Per-page `isPageVisible` gating in each `page.tsx` is unchanged. The layout
renders the bar for every /mlb/* route; a gated page still returns ComingSoon
below the bar (acceptable — the bar is inert there). If a dimmed bar over a
ComingSoon page looks wrong, the layout can skip the bar when the child is
gated; deferred until observed.

## Testing / verification (per .claude/rules/web.md)

- `cd web && npx --no-install tsc --noEmit -p .` after each board refactor.
- Dev server (`op run --env-file=../.env.template -- npx next dev -p 3007`),
  curl each changed route + grep for expected content BEFORE stacking commits
  (UI commit-stacking limit: no 3+ UI commits without a load in between).
- Manual toggle test: set game=one matchup + market=HR on props, click Streaks in
  the sidebar → the same game+market are still applied (context survived nav).
- Deploy only via `deploy-web.yml` workflow_dispatch. Keep the tree committed +
  pushed (deploy swap guard aborts on dirty/unpushed live repo).

## Sequencing

1. Provider + bar + hook (`web/components/mlb/`) + `mlb/layout.tsx`. No board
   consumes it yet — bar renders, drives nothing. tsc + dev load.
2. Wire the core toggle trio: props, streaks, research. Verify cross-view
   persistence. (This delivers the owner's stated need.)
3. Wire transparency (market only), games (date + game-scroll), live (game).
4. Wire grades shell (page stays ComingSoon until odds return).

Each step is its own commit(s) with a dev-server load between UI commits.

## Explicitly out of scope

- URL-param / shareable-link sync (v1 skips; addable later).
- Team-sticky game filter (owner chose matchup-resets-daily).
- The recent-K/contact-rate projection penalty (Kurtz gap) — separate, only if
  owner folds it in; not part of this shell work.
- Any change to the projection/tier engines or the conviction logic.
