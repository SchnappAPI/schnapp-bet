# ADR-20260506-1: Bloomberg × Linear redesign — design tokens, shell, PropMatrix v2

Date: 2026-05-06

## Context

`web/` had no design language: empty Tailwind `theme.extend`, empty `globals.css`, no fonts loaded except Georgia inline on the home page, no global navigation, hand-built components with ad-hoc `gray-*` classes. User wanted a redesign committed to a single sharp aesthetic: information-dense Bloomberg Terminal × Linear hybrid, dark, semantic color, every value justified by legibility or meaning.

## Decision

Phase 1 ships a complete design system. CSS variables for `canvas`/`raised`/`surface`/`border`/`fg`/`brand`/`pos`/`neg`/`warn`/`info`/`sport` tokens. Geist Sans + Geist Mono via `next/font`. Type scale, density vars. Nine `lib/ui` primitives: `cn`, `Button`, `Chip`, `SignalGlyph`, `PulseDot`, `Sparkline`, `Tooltip`, `CommandPalette`, `DataTable`. Seven shell components: `Shell`, `Sidebar`, `SidebarLink`, `TopBar`, `Breadcrumb`, `PollingPill`, `ShellContext` — mounted inside `PasscodeGate` in `app/layout.tsx` (no route-group migration).

Two flagship pages: `app/HomeHub.tsx` as a server-rendered "Today Terminal" with SWR `fallbackData` hydration; `components/nba/PropMatrix.tsx` (v2) behind a `?v=2` flag in `app/nba/grades/page.tsx` as a TanStack-Table + react-virtual rewrite of the legacy 24.9 KB PropMatrix.

Backend ships a 10-item §16 work list: schema-cache fix in `lib/queries.ts`; `/api/grades` sport+updated_at+params wrapper; new `/api/grades/top` (combined with signal counts in one response); `/api/grades/signals/today` (kept for parity); `/api/games/today` aggregator (NBA + MLB cross-sport); `/api/player/[id]/history`; `/api/search` (auth-gated); `lib/etag.ts` helper; narrow auth middleware matcher (`/api/search` only — broader scope would 401 every existing client fetch in prod).

Next.js bumped 15.2.8 → 15.5.16 (16.x had Turbopack persistence crashes in our environment). PWA: manifest `theme_color` synced to `#08090A`; `sw.js` fetch handler split into network-first / stale-while-revalidate / cache-first by route. MLB sidebar collapsed to a single Games entry (sub-views are page-level tabs, matching NBA pattern).

## Consequences

- Phase 2 reskins the rest of the app (NBA games tabs, MLB views, player pages) using the new tokens — partially done by a parallel reskin pass over `GameTabs`, `BoxScoreTable`, `TrendsGrid`, `StatsTable`, `LiveBoxScore`, `MatchupGrid`.
- Legacy `components/PropMatrix.tsx` stays in tree until v2 is promoted to default.
- The app is now an installable PWA targeting iOS Add to Home Screen with the new theme color.
- Dev mode requires Node 20 (engines pin); Node 25 + Turbopack 16 produced persistence-layer crashes.
- `/api/search` requires the frontend SWR fetcher to inject `X-Auth-Token`. Other routes are open as before.
