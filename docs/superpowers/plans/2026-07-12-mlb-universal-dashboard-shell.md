# MLB Universal Dashboard Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One persistent filter bar (game / market / date) shared across all `/mlb/*` views so filter state survives switching screens.

**Architecture:** A new `web/app/mlb/layout.tsx` renders `MlbFilterProvider` (React context owning `{date, market, game}`) + a `MlbFilterBar`. Next.js nested layouts do not remount on child-route change, so the bar and its state persist as the board below swaps. Boards read context via `useMlbFilters()` instead of local filter state. Game filtering is client-side on `teamAbbr` (props/streaks) or native `gamePk` (research). No new APIs, no schema changes.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, Tailwind. SWR/`fetch` as already used per board.

## Global Constraints

- tsc must run from `web/`: `cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d/web && npx --no-install tsc --noEmit -p .`. Empty stdout is only valid if the `cd` happened.
- Dev server: `cd web && op run --env-file=../.env.template -- npx next dev -p 3007` (use `next dev`, NOT `--turbopack`).
- Verify each changed surface on the dev server (curl the route + grep expected text) BEFORE stacking the next UI commit. Never stack 3+ UI commits without a load in between.
- After every `git commit`, run `git status`; if "ahead", `git push` manually.
- Commit subject format enforced: `<type>: [scope1][scope2] short description`. Scopes here: `[mlb][web]`. Types: `feat`/`refactor`/`docs`.
- Never hardcode hostnames/IPs; read `process.env.*`.
- `revalidateOnFocus: false` on any SWR hook.
- Do NOT deploy from this plan. Deploy is a separate owner-gated `/deploy` step; the deploy swap guard aborts on a dirty/unpushed live tree.
- Working dir is the worktree: `/Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d`. Never write into `/Users/schnapp/code/schnapp-bet` (the live checkout on `main`).

## File Structure

**New:**

- `web/lib/mlbFilters.ts` — shared types (`CanonicalMarket`, `GameSel`), constants (`MLB_MARKETS`), and pure helpers (`shiftDate`, `fmtSlateDate`, `gameSelFromSlate`, `applicabilityForPath`).
- `web/components/mlb/MlbFilterProvider.tsx` — context provider (owns state, localStorage for market, slate fetch for the dropdown) + `useMlbFilters()` hook.
- `web/components/mlb/MlbFilterBar.tsx` — the three controls; derives per-screen applicability from `usePathname()`.
- `web/app/mlb/layout.tsx` — mounts provider + bar above all `/mlb/*` pages.

**Modified:**

- `web/app/mlb/props/MlbPropsBoard.tsx` — read context; drop local market/date UI; client game-filter.
- `web/app/mlb/streaks/MlbStreaksBoard.tsx` — read context; pass `date` to API; client game-filter; map market.
- `web/app/mlb/research/MlbResearchView.tsx` — drive grid from context `date` + `game.gamePk`.
- `web/app/mlb/transparency/MlbTransparency.tsx` — read `market` from context.
- `web/app/mlb/MlbPageInner.tsx` — read `date` from context; game selection scrolls to the card.
- `web/app/mlb/MlbHardHitLive.tsx` — client game-filter from context.
- `web/app/mlb/grades/MlbGradesPageInner.tsx` — read context (page is dark; wire only).

**Docs (final task):**

- `docs/decisions/ADR-20260712-5-mlb-dashboard-shell.md`, `MEMORY.md`.

---

### Task 1: Shared types + pure helpers (`web/lib/mlbFilters.ts`)

**Files:**

- Create: `web/lib/mlbFilters.ts`

**Interfaces:**

- Consumes: `SlateGame` type from `@/app/api/mlb/research/slate/route`.
- Produces:
  - `type CanonicalMarket = "HR" | "HRR" | "HITS"`
  - `type GameSel = { gamePk: number; awayAbbr: string; homeAbbr: string; label: string } | null`
  - `const MLB_MARKETS: { key: CanonicalMarket; label: string }[]`
  - `function shiftDate(date: string, days: number): string`
  - `function fmtSlateDate(date: string): string`
  - `function gameSelFromSlate(g: SlateGame): NonNullable<GameSel>`
  - `type FilterApplicability = { game: boolean; market: boolean; date: boolean }`
  - `function applicabilityForPath(pathname: string): FilterApplicability`

- [ ] **Step 1: Create the file with types, constants, and helpers**

```ts
// web/lib/mlbFilters.ts
import type { SlateGame } from "@/app/api/mlb/research/slate/route";

export type CanonicalMarket = "HR" | "HRR" | "HITS";

export const MLB_MARKETS: { key: CanonicalMarket; label: string }[] = [
  { key: "HR", label: "HR" },
  { key: "HRR", label: "H+R+RBI" },
  { key: "HITS", label: "Hits" },
];

export type GameSel = {
  gamePk: number;
  awayAbbr: string;
  homeAbbr: string;
  label: string;
} | null;

export function gameSelFromSlate(g: SlateGame): NonNullable<GameSel> {
  const away = g.awayTeamAbbr ?? "AWY";
  const home = g.homeTeamAbbr ?? "HOM";
  return {
    gamePk: g.gamePk,
    awayAbbr: away,
    homeAbbr: home,
    label: `${away} @ ${home}`,
  };
}

// Add `days` to a YYYY-MM-DD date without timezone drift (UTC-noon anchor).
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// "2026-07-12" -> "Jul 12"
export function fmtSlateDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export type FilterApplicability = {
  game: boolean;
  market: boolean;
  date: boolean;
};

// Which of the three filters affect a given /mlb route. Disabled (not hidden)
// controls keep the bar visually stable across views.
export function applicabilityForPath(pathname: string): FilterApplicability {
  if (pathname.startsWith("/mlb/props"))
    return { game: true, market: true, date: true };
  if (pathname.startsWith("/mlb/streaks"))
    return { game: true, market: true, date: true };
  if (pathname.startsWith("/mlb/research"))
    return { game: true, market: false, date: true };
  if (pathname.startsWith("/mlb/transparency"))
    return { game: false, market: true, date: false };
  if (pathname.startsWith("/mlb/live"))
    return { game: true, market: false, date: false };
  if (pathname.startsWith("/mlb/grades"))
    return { game: true, market: true, date: true };
  if (pathname === "/mlb") return { game: true, market: false, date: true };
  return { game: true, market: true, date: true };
}
```

- [ ] **Step 2: Confirm the `SlateGame` field names match**

Read `web/app/api/mlb/research/slate/route.ts` and confirm the exported `SlateGame` type has `gamePk: number`, `awayTeamAbbr` and `homeTeamAbbr` (string | null). If a name differs, fix the references in `gameSelFromSlate`. Do not guess — read it.

Run: `grep -nE "gamePk|awayTeamAbbr|homeTeamAbbr|export (type|interface) SlateGame" web/app/api/mlb/research/slate/route.ts`
Expected: all three fields present on the exported type.

- [ ] **Step 3: Typecheck**

Run: `cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d/web && npx --no-install tsc --noEmit -p .`
Expected: exit 0, empty stdout.

- [ ] **Step 4: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add web/lib/mlbFilters.ts
git commit -m "feat: [mlb][web] shared filter types + helpers for the MLB dashboard shell"
git status -sb | head -2   # push if "ahead"
```

---

### Task 2: Filter context provider + hook (`MlbFilterProvider.tsx`)

**Files:**

- Create: `web/components/mlb/MlbFilterProvider.tsx`

**Interfaces:**

- Consumes: `CanonicalMarket`, `GameSel`, `gameSelFromSlate` from `@/lib/mlbFilters`; `SlateGame` from the slate route; `todayCT` from `@/lib/mlbLive`.
- Produces:
  - `function MlbFilterProvider({ children }: { children: React.ReactNode }): JSX.Element`
  - `function useMlbFilters(): MlbFilterContextValue`
  - `type MlbFilterContextValue = { date: string; setDate: (d: string) => void; market: CanonicalMarket; setMarket: (m: CanonicalMarket) => void; game: GameSel; setGame: (g: GameSel) => void; slateGames: SlateGame[]; slateLoading: boolean }`

- [ ] **Step 1: Create the provider**

```tsx
// web/components/mlb/MlbFilterProvider.tsx
"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { SlateGame } from "@/app/api/mlb/research/slate/route";
import type { CanonicalMarket, GameSel } from "@/lib/mlbFilters";
import { todayCT } from "@/lib/mlbLive";

export type MlbFilterContextValue = {
  date: string;
  setDate: (d: string) => void;
  market: CanonicalMarket;
  setMarket: (m: CanonicalMarket) => void;
  game: GameSel;
  setGame: (g: GameSel) => void;
  slateGames: SlateGame[];
  slateLoading: boolean;
};

const MlbFilterContext = createContext<MlbFilterContextValue | null>(null);

const MARKET_KEY = "sb.mlb.market";

function readStoredMarket(): CanonicalMarket {
  if (typeof window === "undefined") return "HR";
  try {
    const v = window.localStorage.getItem(MARKET_KEY);
    if (v === "HR" || v === "HRR" || v === "HITS") return v;
  } catch {
    /* localStorage unavailable (privacy mode) — fall through */
  }
  return "HR";
}

export function MlbFilterProvider({ children }: { children: React.ReactNode }) {
  const [date, setDate] = useState<string>(() => todayCT());
  const [market, setMarketState] = useState<CanonicalMarket>("HR");
  const [game, setGame] = useState<GameSel>(null);
  const [slateGames, setSlateGames] = useState<SlateGame[]>([]);
  const [slateLoading, setSlateLoading] = useState(false);

  // Hydrate market from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    setMarketState(readStoredMarket());
  }, []);

  const setMarket = (m: CanonicalMarket) => {
    setMarketState(m);
    try {
      window.localStorage.setItem(MARKET_KEY, m);
    } catch {
      /* ignore */
    }
  };

  // Fetch the slate for the current date (drives the game dropdown) and
  // revalidate the selected game against it.
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    setSlateLoading(true);
    fetch(`/api/mlb/research/slate?date=${date}`)
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((d: { games?: SlateGame[] }) => {
        if (id !== reqId.current) return; // stale response
        const games = d.games ?? [];
        setSlateGames(games);
        setGame((cur) =>
          cur && games.some((g) => g.gamePk === cur.gamePk) ? cur : null,
        );
      })
      .catch(() => {
        if (id !== reqId.current) return;
        setSlateGames([]);
        setGame(null);
      })
      .finally(() => {
        if (id === reqId.current) setSlateLoading(false);
      });
  }, [date]);

  const value: MlbFilterContextValue = {
    date,
    setDate,
    market,
    setMarket,
    game,
    setGame,
    slateGames,
    slateLoading,
  };

  return (
    <MlbFilterContext.Provider value={value}>
      {children}
    </MlbFilterContext.Provider>
  );
}

export function useMlbFilters(): MlbFilterContextValue {
  const ctx = useContext(MlbFilterContext);
  if (!ctx) {
    throw new Error("useMlbFilters must be used within <MlbFilterProvider>");
  }
  return ctx;
}
```

- [ ] **Step 2: Confirm `todayCT` export**

Run: `grep -n "export.*todayCT" web/lib/mlbLive.ts`
Expected: `export const todayCT = ...` (signature `() => string`, YYYY-MM-DD). If it is not exported, export it (add `export`).

- [ ] **Step 3: Typecheck**

Run: `cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d/web && npx --no-install tsc --noEmit -p .`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add web/components/mlb/MlbFilterProvider.tsx web/lib/mlbLive.ts
git commit -m "feat: [mlb][web] MlbFilterProvider context + useMlbFilters hook (market->localStorage, slate-driven game revalidation)"
git status -sb | head -2
```

---

### Task 3: Filter bar + layout (`MlbFilterBar.tsx`, `mlb/layout.tsx`)

Delivers the visible persistent bar over every `/mlb/*` route. The bar reads context and drives nothing yet (boards still use their own state until Tasks 4–11) — but it renders and mutates context.

**Files:**

- Create: `web/components/mlb/MlbFilterBar.tsx`
- Create: `web/app/mlb/layout.tsx`

**Interfaces:**

- Consumes: `useMlbFilters`, `MLB_MARKETS`, `shiftDate`, `fmtSlateDate`, `gameSelFromSlate`, `applicabilityForPath`, `usePathname`.
- Produces: `MlbFilterBar` (default-exported component, no props), `MlbLayout` (default-exported layout).

- [ ] **Step 1: Create the bar**

```tsx
// web/components/mlb/MlbFilterBar.tsx
"use client";

import { usePathname } from "next/navigation";
import { useMlbFilters } from "./MlbFilterProvider";
import {
  MLB_MARKETS,
  applicabilityForPath,
  fmtSlateDate,
  gameSelFromSlate,
  shiftDate,
} from "@/lib/mlbFilters";

export default function MlbFilterBar() {
  const { date, setDate, market, setMarket, game, setGame, slateGames } =
    useMlbFilters();
  const pathname = usePathname() ?? "/mlb";
  const applies = applicabilityForPath(pathname);

  const dim = (on: boolean) =>
    on ? "" : "opacity-40 pointer-events-none select-none";

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2 text-sm">
      {/* GAME */}
      <div className={`flex items-center gap-1.5 ${dim(applies.game)}`}>
        <span className="text-muted">Game</span>
        <select
          className="rounded border border-border bg-bg px-2 py-1"
          value={game?.gamePk ?? ""}
          disabled={!applies.game}
          onChange={(e) => {
            const pk = e.target.value ? Number(e.target.value) : null;
            const g = pk ? slateGames.find((s) => s.gamePk === pk) : null;
            setGame(g ? gameSelFromSlate(g) : null);
          }}
        >
          <option value="">All games</option>
          {slateGames.map((g) => {
            const away = g.awayTeamAbbr ?? "AWY";
            const home = g.homeTeamAbbr ?? "HOM";
            return (
              <option key={g.gamePk} value={g.gamePk}>
                {away} @ {home}
              </option>
            );
          })}
        </select>
      </div>

      {/* MARKET */}
      <div className={`flex items-center gap-1 ${dim(applies.market)}`}>
        <span className="text-muted">Market</span>
        {MLB_MARKETS.map((m) => (
          <button
            key={m.key}
            type="button"
            disabled={!applies.market}
            onClick={() => setMarket(m.key)}
            className={`rounded px-2 py-1 ${
              market === m.key
                ? "bg-brand text-white"
                : "border border-border bg-bg"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* DATE */}
      <div className={`flex items-center gap-1 ${dim(applies.date)}`}>
        <button
          type="button"
          disabled={!applies.date}
          onClick={() => setDate(shiftDate(date, -1))}
          className="rounded border border-border bg-bg px-2 py-1"
          aria-label="Previous day"
        >
          ‹
        </button>
        <span className="min-w-[3.5rem] text-center tabular-nums">
          {fmtSlateDate(date)}
        </span>
        <button
          type="button"
          disabled={!applies.date}
          onClick={() => setDate(shiftDate(date, 1))}
          className="rounded border border-border bg-bg px-2 py-1"
          aria-label="Next day"
        >
          ›
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Confirm Tailwind color tokens exist**

The bar uses `border-border`, `bg-surface`, `bg-bg`, `text-muted`, `bg-brand`. Confirm these are defined (they are used across existing boards).
Run: `grep -rnoE "bg-surface|border-border|text-muted|bg-brand|bg-bg" web/app/mlb/props/MlbPropsBoard.tsx web/tailwind.config.* 2>/dev/null | head`
Expected: at least the token names appear in existing code. If a token is absent, substitute the nearest token the existing boards actually use (read `MlbPropsBoard.tsx` header for its container classes and match them).

- [ ] **Step 3: Create the layout**

```tsx
// web/app/mlb/layout.tsx
import { MlbFilterProvider } from "@/components/mlb/MlbFilterProvider";
import MlbFilterBar from "@/components/mlb/MlbFilterBar";

export default function MlbLayout({ children }: { children: React.ReactNode }) {
  return (
    <MlbFilterProvider>
      <MlbFilterBar />
      {children}
    </MlbFilterProvider>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d/web && npx --no-install tsc --noEmit -p .`
Expected: exit 0.

- [ ] **Step 5: Dev-server load — bar renders on every route**

Start the dev server (background): `cd web && op run --env-file=../.env.template -- npx next dev -p 3007`.
Then:

```bash
for p in mlb mlb/props mlb/streaks mlb/research mlb/transparency mlb/live mlb/grades; do
  echo "== /$p =="; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3007/$p"
done
curl -s "http://127.0.0.1:3007/mlb/props" | grep -c "All games"
```

Expected: every route returns `200`; the `All games` grep is `>= 1` (bar present). If a page is feature-gated to ComingSoon, the bar still renders above it — that is acceptable.

- [ ] **Step 6: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add web/components/mlb/MlbFilterBar.tsx web/app/mlb/layout.tsx
git commit -m "feat: [mlb][web] persistent MLB filter bar + mlb/layout.tsx shell (game/market/date; per-screen applicability)"
git status -sb | head -2
```

---

### Task 4: Wire the props board

**Files:**

- Modify: `web/app/mlb/props/MlbPropsBoard.tsx`

**Interfaces:**

- Consumes: `useMlbFilters()` (`date`, `market`, `game`).
- Produces: nothing new.

Read the whole file first. Current relevant anchors (verify by reading): `const [market, setMarket] = useState<PropMarket>("HR")` (~~:103), `const [date, setDate] = useState<string | null>(null)` (~~:104), fetch at ~:109, prev/next date-nav UI ~:206-225, market selector UI ~:236-243, row render with `r.teamAbbr` ~:352.

- [ ] **Step 1: Replace local market/date state with context**

- Remove the local `market`/`setMarket` and `date`/`setDate` `useState` lines.
- At the top of the component add: `const { date: ctxDate, market: ctxMarket, game } = useMlbFilters();`
- The board's `PropMarket` type is `"HR" | "HRR" | "HITS"` — identical to `CanonicalMarket`, so use `ctxMarket` directly wherever `market` was read.
- The board previously used `date: string | null` (null = latest). Context `date` is always a concrete `YYYY-MM-DD`. Change the fetch to always pass it: `fetch(\`/api/mlb-props?date=${ctxDate}\`)`. Keep the existing `availableDates` guard behavior in the API (it validates the date and 400s if absent — the board should render the API's empty/"no slice" state, not crash).
- Delete the board's inline date-nav UI (~~:206-225) and inline market selector UI (~~:236-243) — these now live in the shared bar.

- [ ] **Step 2: Add the client-side game filter**

Where the board maps rows to JSX (after any existing market filter), filter by the selected game's two team abbreviations:

```tsx
const gameFilteredRows = rows.filter(
  (r) => !game || r.teamAbbr === game.awayAbbr || r.teamAbbr === game.homeAbbr,
);
```

Render `gameFilteredRows` instead of `rows`. If the board already has an intermediate filtered array (e.g. by market/conviction), apply the game filter to that array so all filters compose. When `game` is set but no rows match (team not on this slice), show the board's existing empty state — do not blank the page.

- [ ] **Step 3: Typecheck**

Run: `cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d/web && npx --no-install tsc --noEmit -p .`
Expected: exit 0.

- [ ] **Step 4: Dev-server load + filter behavior**

```bash
curl -s "http://127.0.0.1:3007/mlb/props" | grep -c "All games"     # bar present
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3007/mlb/props"
```

Expected: 200, bar present. Then in a browser (or via the dev server): select a game in the bar → props rows collapse to that matchup's two teams; switch market pill → board re-tiers; prev/next date → board reloads that slice.

- [ ] **Step 5: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add web/app/mlb/props/MlbPropsBoard.tsx
git commit -m "refactor: [mlb][web] props board reads shared filter context; adds game filter, drops inline market/date UI"
git status -sb | head -2
```

---

### Task 5: Wire the streaks board

**Files:**

- Modify: `web/app/mlb/streaks/MlbStreaksBoard.tsx`

**Interfaces:**

- Consumes: `useMlbFilters()` (`date`, `market`, `game`).
- Produces: nothing new.

Read the whole file first. Anchors: `const [market, setMarket] = useState<StreakMarket>("HR")` (~~:224), fetch `/api/mlb-streaks` with no date (~~:228), market selector UI (~:286-293). `StreakMarket` is `"HR" | "HIT" | "HRR2" | "HRR3" | "RBI"`. Rows carry `teamAbbr`.

- [ ] **Step 1: Add a canonical→streak market mapper (local to this file)**

```tsx
import type { CanonicalMarket } from "@/lib/mlbFilters";
// StreakMarket is this board's local type.
function streakMarketFrom(
  m: CanonicalMarket,
  current: StreakMarket,
): StreakMarket {
  if (m === "HR") return "HR";
  if (m === "HITS") return "HIT";
  if (m === "HRR") return current === "HRR3" ? "HRR3" : "HRR2"; // keep a chosen HRR variant
  return current;
}
```

- [ ] **Step 2: Replace local market state + wire date**

- Add: `const { date: ctxDate, market: ctxMarket, game } = useMlbFilters();`
- Keep a local `const [market, setMarket] = useState<StreakMarket>("HR")` ONLY IF the board must let the user pick HRR2 vs HRR3 (a distinction the shared HRR pill can't express). Otherwise remove it. Recommended: keep a local `market` but drive it from context via an effect: `useEffect(() => setMarket((cur) => streakMarketFrom(ctxMarket, cur)), [ctxMarket]);`. This preserves the HRR2/HRR3 sub-choice while the shared bar sets the family.
- Change the fetch to pass the date: `fetch(\`/api/mlb-streaks?date=${ctxDate}\`, ...)`. The API already accepts `?date=` (defaults to today when absent).
- Remove the inline market selector UI (~:286-293) from the board header — the family selector now lives in the shared bar. If you kept the HRR2/HRR3 sub-toggle, leave ONLY that sub-toggle (a two-button toggle shown when the family is HRR), not the full market list.

- [ ] **Step 3: Add the client-side game filter**

```tsx
const shownRows = rows.filter(
  (r) => !game || r.teamAbbr === game.awayAbbr || r.teamAbbr === game.homeAbbr,
);
```

Render `shownRows`. Compose with any existing filtered array. Preserve the confidence-weighted rank ordering already applied before filtering (filter after sort, or sort the filtered array the same way).

- [ ] **Step 4: Typecheck**

Run: `cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d/web && npx --no-install tsc --noEmit -p .`
Expected: exit 0.

- [ ] **Step 5: Dev-server load**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3007/mlb/streaks"
curl -s "http://127.0.0.1:3007/mlb/streaks" | grep -c "All games"
```

Expected: 200, bar present. Browser: date nav now reloads the streaks slate for that date; selecting a game filters to its batters; market pill switches HR/Hits (and reveals the HRR2/HRR3 sub-toggle if kept).

- [ ] **Step 6: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add web/app/mlb/streaks/MlbStreaksBoard.tsx
git commit -m "refactor: [mlb][web] streaks board reads shared filter context; wires date param + game filter, maps canonical market"
git status -sb | head -2
```

---

### Task 6: Wire the research board

**Files:**

- Modify: `web/app/mlb/research/MlbResearchView.tsx`
- Modify (if it owns the game slicer): `web/app/mlb/research/ResearchFilters.tsx`

**Interfaces:**

- Consumes: `useMlbFilters()` (`date`, `game`).
- Produces: nothing new.

Read both files first. Current: `MlbResearchView` reads `useSearchParams()` for `date` (~~:423-425, `?? todayCentral()`) and `gamePkParam` (~~:450-453 resolves to first slate game). `ResearchFilters` writes `date`/`gamePk`/`hand`/`abNum` to the URL (~:39 `writeParams`, game slicer buttons ~:60-66).

- [ ] **Step 1: Drive date + gamePk from context**

- In `MlbResearchView`, replace the `date` source: `const { date, game } = useMlbFilters();` instead of `sp.get("date") ?? todayCentral()`.
- Replace `gamePk` resolution: `const gamePk = game?.gamePk ?? firstSlateGamePk;` where `firstSlateGamePk` is the existing first-game fallback (keep that fallback so a null game still shows a board). Remove the `sp.get("gamePk")` read.
- Keep the board's own `hand` and `abNum` slicers (these are research-specific, not shared) — leave them on `ResearchFilters`/URL as they are.

- [ ] **Step 2: Remove the now-duplicated game + date controls from `ResearchFilters`**

- Delete the game slicer buttons (~:60-66) and any date control from `ResearchFilters` — the shared bar owns game and date. Keep hand + abNum controls.
- If `writeParams` still needs `date`/`gamePk` for the hand/abNum fetch keys, source them from context instead (pass `date`/`gamePk` as props into `ResearchFilters`, or read context there too). Do NOT keep two sources of truth for game/date.

- [ ] **Step 3: Typecheck**

Run: `cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d/web && npx --no-install tsc --noEmit -p .`
Expected: exit 0.

- [ ] **Step 4: Dev-server load**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3007/mlb/research"
curl -s "http://127.0.0.1:3007/mlb/research" | grep -c "All games"
```

Expected: 200, bar present. Browser: selecting a game in the bar switches the research heat grid to that matchup; date nav changes the slate; the market pill is dimmed (research has no market axis); hand/abNum slicers still work.

- [ ] **Step 5: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add web/app/mlb/research/MlbResearchView.tsx web/app/mlb/research/ResearchFilters.tsx
git commit -m "refactor: [mlb][web] research board driven by shared filter context (game->gamePk, date); removes duplicate in-board game/date controls"
git status -sb | head -2
```

---

### Task 7: Cross-view persistence checkpoint

No code. This is the gate that proves the core goal: filters survive switching screens. If it fails, the provider is not mounted in the persistent layout (or a board still uses local state).

- [ ] **Step 1: Manual toggle test in the browser**

With the dev server running:

1. Open `/mlb/props`. Set Game = a specific matchup, Market = HITS, step Date back one day.
2. Click **Streaks** in the sidebar (a real navigation to `/mlb/streaks`).
3. Confirm the bar still shows the same Game, the same date, and Market mapped to `HIT` — and the streaks board is filtered to that matchup on that date.
4. Click **Research** → same game + date carried; market pill dimmed.
5. Reload the whole page on `/mlb/streaks`: Market should persist (localStorage); Game/Date reset to default (session-only, by design).

Expected: steps 2–4 retain state with no re-selection. Step 5 keeps only market.

- [ ] **Step 2: If it fails**

- State resets on nav → the provider is not in `app/mlb/layout.tsx`, or a board kept its own `useState` for that filter. Re-check Tasks 3–6.
- No commit for this task (verification only). Record the result in the task tracker.

---

### Task 8: Wire the transparency board (market only)

**Files:**

- Modify: `web/app/mlb/transparency/MlbTransparency.tsx`

**Interfaces:**

- Consumes: `useMlbFilters()` (`market`).

Read the file first. Anchors: `const [market, setMarket] = useState<"HR"|"HRR"|"HITS">("HR")` (~~:43), market selector UI (~~:113-119). It renders a multi-day matrix; game/date do not apply (the bar dims them via `applicabilityForPath`).

- [ ] **Step 1: Drive market from context**

- Add `const { market } = useMlbFilters();` and use it in place of the local state; remove the local `market`/`setMarket` `useState` and the inline market selector UI (~:113-119).
- Do NOT wire game or date — they are intentionally disabled for this screen.

- [ ] **Step 2: Typecheck + load**

Run: `cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d/web && npx --no-install tsc --noEmit -p .` (exit 0)
Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3007/mlb/transparency"` (200)
Browser: switching the market pill changes the transparency pane; game + date controls are visibly dimmed and inert.

- [ ] **Step 3: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add web/app/mlb/transparency/MlbTransparency.tsx
git commit -m "refactor: [mlb][web] transparency board reads market from shared context (game/date N/A, dimmed in bar)"
git status -sb | head -2
```

---

### Task 9: Wire the games list (`/mlb`)

**Files:**

- Modify: `web/app/mlb/MlbPageInner.tsx`

**Interfaces:**

- Consumes: `useMlbFilters()` (`date`, `game`, `setGame`).

Read the file first. Anchors: `useSearchParams()` + `urlDate` (~~:275-278), `const [selectedDate, setSelectedDate]` (~~:279), fetch `/api/mlb-games?date=${selectedDate}` (~~:310), `params.set("date", ...)` (~~:346), header date-nav UI (~:358-384). This board currently owns date via URL + local mirror.

- [ ] **Step 1: Make context the date source of truth**

- Replace `selectedDate`/`setSelectedDate` with context: `const { date, setDate, game, setGame } = useMlbFilters();`. Fetch `/api/mlb-games?date=${date}`.
- Remove the board's inline date-nav header (~~:358-384) — the shared bar owns date. Keep the `tab` searchParam handling (~~:287) as-is (tab is board-specific, not a shared filter).
- Drop the `params.set("date", ...)` URL writes for date (context owns it now). Leave tab writes intact.

- [ ] **Step 2: Game selection scrolls to the card**

- Give each game card a DOM id: `id={\`game-${g.gamePk}\`}` (use the field the board already has for game id).
- Add an effect that scrolls to the selected game when it changes:

```tsx
useEffect(() => {
  if (!game) return;
  const el = document.getElementById(`game-${game.gamePk}`);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}, [game]);
```

- Optionally add a highlight ring on the matching card: `className={cardClass + (game?.gamePk === g.gamePk ? " ring-2 ring-brand" : "")}`.

- [ ] **Step 3: Typecheck + load**

Run tsc (exit 0). Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3007/mlb"` (200). Browser: date nav in the bar changes the games slate; picking a game scrolls/highlights its card; market pill dimmed.

- [ ] **Step 4: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add web/app/mlb/MlbPageInner.tsx
git commit -m "refactor: [mlb][web] games list date from shared context; bar game-select scrolls/highlights the card"
git status -sb | head -2
```

---

### Task 10: Wire the live board

**Files:**

- Modify: `web/app/mlb/MlbHardHitLive.tsx`

**Interfaces:**

- Consumes: `useMlbFilters()` (`game`).

Read the file first. Per MEMORY, this board already has a game-filter chip row. Goal: drive that filter from the shared `game` instead of (or in addition to) its own chips.

- [ ] **Step 1: Filter the live board by the shared game**

- Add `const { game } = useMlbFilters();`.
- If the board keys hard-hit rows by `gamePk`, filter to `game.gamePk` when set: `balls.filter((b) => !game || b.gamePk === game.gamePk)`. Use the actual per-row game id field (read the row type — likely `gamePk`).
- If the board has its own game chip row, either remove it (shared bar supersedes) or have the chips call `setGame`. Recommended: remove the local chips; the bar owns game now. Date is pinned to today for live (bar dims date).

- [ ] **Step 2: Typecheck + load**

Run tsc (exit 0). Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3007/mlb/live"` (200). Browser during a live slate (or against stubbed data): selecting a game narrows the hard-hit table to that matchup.

- [ ] **Step 3: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add web/app/mlb/MlbHardHitLive.tsx
git commit -m "refactor: [mlb][web] live board hard-hit table filtered by shared game selection"
git status -sb | head -2
```

---

### Task 11: Wire the grades shell (dark page)

**Files:**

- Modify: `web/app/mlb/grades/MlbGradesPageInner.tsx`

**Interfaces:**

- Consumes: `useMlbFilters()` (`date`, `market`, `game`).

Read the file first. The page is DARK (odds dead → its `page.tsx` returns ComingSoon; per MEMORY grades is not visible). The board already has local `date`/`market`/`gamePk` state (~:138-143) and does client-side market/game filtering. Wire it so that WHEN odds return it already honors the shared bar — but keep the change minimal since the page renders ComingSoon today.

- [ ] **Step 1: Read date/market/game from context (guarded)**

- Add `const { date: ctxDate, market: ctxMarket, game } = useMlbFilters();`.
- Use `ctxDate` for the SWR key instead of local `date`. Map `ctxMarket` to the board's market vocab (it uses FanDuel market keys — add a small mapper or default when no equivalent). Use `game?.gamePk` for the board's `gamePk` filter.
- Remove the board's inline date/market/game controls (~:271-329) — superseded by the bar.
- Because the page returns ComingSoon, this is not browser-verifiable today. Verify tsc only, plus that the page still returns its ComingSoon (feature flag unchanged).

- [ ] **Step 2: Typecheck + load**

Run tsc (exit 0). Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3007/mlb/grades"` (200 — ComingSoon body). Confirm the page did not start rendering live grades (flag still off): `curl -s "http://127.0.0.1:3007/mlb/grades" | grep -ci "coming soon"` ≥ 1 (or whatever the ComingSoon component text is — confirm by reading `web/components/.../ComingSoon`).

- [ ] **Step 3: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add web/app/mlb/grades/MlbGradesPageInner.tsx
git commit -m "refactor: [mlb][web] grades board reads shared filter context (dark page; ready for when odds return)"
git status -sb | head -2
```

---

### Task 12: ADR + MEMORY (milestone closeout)

New architectural convention (persistent `mlb/layout.tsx` + shared filter context) → milestone tier per CLAUDE.md → ADR required.

**Files:**

- Create: `docs/decisions/ADR-20260712-5-mlb-dashboard-shell.md`
- Modify: `MEMORY.md`

- [ ] **Step 1: Write the ADR**

Use the repo's ADR template (see any `docs/decisions/ADR-*.md`). Record: the decision (nested-layout persistent bar + `MlbFilterProvider` context; market→localStorage, date/game session-only; game=matchup-resets-daily; client-side `teamAbbr` filter for props/streaks, native `gamePk` for research; no URL-sync in v1; per-screen applicability disable-not-hide), the alternatives rejected (URL-param sync, team-sticky game), and the consequences. Title references this as its first application.

- [ ] **Step 2: Update MEMORY.md**

Add a Current Focus entry summarizing the shell: what shipped, the files, the persistence model, and the deploy note (deploy swap guard aborts on a dirty/unpushed live tree — commit + push MEMORY before `/deploy`).

- [ ] **Step 3: Commit**

```bash
cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d
git add docs/decisions/ADR-20260712-5-mlb-dashboard-shell.md MEMORY.md
git commit -m "docs: [mlb][web][meta] ADR-20260712-5 MLB dashboard shell + MEMORY closeout"
git status -sb | head -2
```

- [ ] **Step 4: Final full typecheck**

Run: `cd /Users/schnapp/code/schnapp-bet/.claude/worktrees/friendly-curie-90239d/web && npx --no-install tsc --noEmit -p .`
Expected: exit 0. Stop the dev server. Deploy is a separate owner-gated step.

---

## Self-Review

**Spec coverage:**

- Persistent bar via nested layout → Task 3. ✓
- Context state (market/date/game), market→localStorage, date/game session-only → Task 2. ✓
- Game = matchup dropdown from slate, resets daily, revalidate on date change → Task 2 (revalidation effect) + Task 3 (dropdown). ✓
- Per-screen applicability disable-not-hide → Task 1 (`applicabilityForPath`) + Task 3 (bar `dim`). ✓
- props client `teamAbbr` filter → Task 4. ✓
- streaks date param + client filter + market map → Task 5. ✓
- research `gamePk` native → Task 6. ✓
- transparency market only → Task 8. ✓
- games list date + game-scroll → Task 9. ✓
- live game filter → Task 10. ✓
- grades shell (dark) → Task 11. ✓
- No new APIs / no schema change → honored (all filters client-side or existing params). ✓
- Cross-view persistence proof → Task 7. ✓
- ADR + MEMORY (milestone) → Task 12. ✓

**Placeholder scan:** New-file code (Tasks 1–3) is complete and runnable. Board-modification tasks (4–11) give exact anchors + the actual filter code, and instruct reading the file first because their exact current contents (350+ lines each) can't be reproduced verbatim in-plan — this is deliberate, not a placeholder. No "TBD"/"add error handling"/"similar to Task N" left.

**Type consistency:** `CanonicalMarket` = `"HR"|"HRR"|"HITS"` used identically in Tasks 1/2/3/4/8. `GameSel` shape (`gamePk/awayAbbr/homeAbbr/label`) consistent across Tasks 1/2/3 and consumed by the `teamAbbr` filters in Tasks 4/5/10. `useMlbFilters()` return shape defined once in Task 2, consumed unchanged in 3–11. `streakMarketFrom` (Task 5) is the only market mapper and is local to the streaks board.
