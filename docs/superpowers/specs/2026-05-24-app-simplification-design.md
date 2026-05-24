# App simplification — design spec

Date: 2026-05-24
Status: Draft (approved in brainstorming, pending user review of written spec)
Brainstorm artifacts: `.superpowers/brainstorm/86605-1779629809/content/*.html` (gitignored — for reference within the session, not source of truth)

## Goal

Restructure the public surface of schnapp.bet around two things — **player logs** and **game logs** — and remove grading from the public surface while keeping it accessible to admin. Public app becomes a logs-first research platform; grading returns through the same routes when the calibration skew is diagnosed.

In scope: NBA + MLB. Out of scope: NFL (hidden until season).

## Approach (B — surface restructure)

Restructure visible app surface. Grading code stays in place. Existing routes remain reachable for admin via the existing `sb_unlock=go` cookie. New routes added where the redesign needs them. New APIs added only where existing endpoints can't serve the filtered / split views.

Rejected alternatives:

- **A — Flag-only pass**: doesn't fix the logs-UX gap that motivated the request.
- **C — Full purge**: deletes grading code; reversibility cost too high given the parallel diagnostic plan.

## Architecture

### Sitemap (after)

```
/                       HomeHub — 2 sport cards (NBA, MLB)
/nba                    Tabs: Games · Players  (?tab=games|players)
/nba/game/[gameId]      Game Log (stacked sections + sticky anchor nav)
/nba/player/[playerId]  Player Log (filter bar + splits table + game log table)
/mlb                    Tabs: Games · Players  (Players has Pitcher/Batter/All role filter)
/mlb/game/[gameId]      MLB Game Log
/mlb/player/[playerId]  MLB Player Log
/admin                  Flag + token management (unchanged)
/fish                   Untouched sandbox — see "Fish sandbox" below

Reachable but unlinked (admin cookie bypasses):
  /nfl                              — hidden via sport.nfl=false
  /lol, /transparency               — hidden via page.lol / page.transparency = false
  /nba/grades                       — hidden via page.nba.grades = false
  /nba/player/[id]/props            — hidden via page.nba.player.props = false
  /mlb/proj, /mlb/ev, /mlb/vs, /mlb/pitcher — hidden via page.mlb.* = false
```

### Top nav

`Home · NBA · MLB · Admin`. Static. Nav doesn't read flags. Pages enforce visibility via `isPageVisible()`. If a sport flag is flipped off later, the nav link still renders; clicking lands on `<ComingSoon />`.

### Fish sandbox

`/fish` is an untouched island. Hard rules:

- `app/fish/page.tsx` is not edited.
- `/api/fish-sync` is not edited or removed.
- **No inbound links**: HomeHub does not list it; top nav does not link it; nothing in the redesign points at it.
- **No outbound links to home from /fish**: existing layout is preserved verbatim, including any pre-existing nav (or lack of one).
- **No flag change**: do not set `page.fish=false`. Leave the flag as-is so the page responds identically to today.
- Reachable only by direct URL `schnapp.bet/fish`.

`/fish` stays isolated from the rest of the app — no inbound or outbound links, no flag flip, no redesign, no rewire. It does **not** disappear from the maintenance radar: Next.js upgrades, dependency bumps, security patches, secrets rotation, and ETL/database changes that touch its data still apply. The redesign simply does not restructure or relink it.

## Components

### HomeHub (`app/page.tsx` + `app/HomeHub.tsx`)

Two-card sport chooser.

- Each card shows sport label, today's game count + live count.
- Card click → `/nba?tab=games` or `/mlb?tab=games`.
- No grades column. No top-grades SWR. `home.top_grades_column` flag is `false` globally including admin (structural decision, not gating).
- `fetchInitial()` SSR preload removed; cards are SWR-driven with 60s poll.
- Removed imports / references in this file: `SignalGlyph`, `GradeRow`, `SignalCounts`, `GradesTopResponse`. The components themselves stay in the repo for grading-return.

Polish (deferred to implementation, not blocking ship):

- Sport-color accents on cards.
- "Next tipoff in X min" subline when no live games.
- Subtle hover state with depth.

### Sport tab pages (`app/nba/NbaPageInner.tsx`, `app/mlb/MlbPageInner.tsx`)

Single page, two tabs driven by `?tab=games|players`.

**Games tab**:

- Groups: Live · Scheduled · Final (yesterday).
- Each game card → `/nba/game/[gameId]` (or `/mlb/game/[gameId]`).
- Reuses `GameStrip` for individual cards; new lightweight `GamesByStatus` grouping component.

**Players tab**:

- `SearchBox` (existing `/api/search`).
- `RecentPlayers` (localStorage-backed list of last 10 viewed).
- `PlayingToday` — from a new endpoint `/api/players/active-today?sport=X`. Default sort: most-used rotation first.
- MLB additionally: chip row `Pitchers / Batters / All` above the section list.

**Existing MLB views** (MlbPitcherView, MlbPlayerView, MlbEvView, MlbVsView, MlbProjView) are unmounted from `/mlb` route. Files stay in repo for grading-return.

### Player Log (`app/nba/player/[playerId]/PlayerPageInner.tsx`)

Five horizontal regions, top to bottom:

1. **Header strip** — photo (32px), name, team · position · jersey, "Next vs DEN · 8:30p ET" link on the right. Bloomberg cool-blue chrome, single sky-300 accent.
2. **Filter bar** — two-row card with side labels.
   - Row 1 `Range` (mutually exclusive): L5 · L10 · L20 · Season · Custom date.
   - Row 2 `Splits` (multi-toggle / pickers): vs Team ▾ · vs Upcoming · Home/Away ▾ · Starter/Bench ▾ · Min > ▾ · W/L ▾ · Opp Rank ▾ · Rest ▾ · B2B · Spread ▾ · Total ▾.
   - Picker chips expand inline within the filter card (no floating popover, no page scroll).
   - Active state = accent border + tinted bg + value surfaced inline (e.g. `vs DEN ▾` shows `DEN` in bright white).
   - "Clear all" + active-count in row endcap.
   - URL-synced: `?range=L10&vs=DEN&starter=1&rest=1,2&...`
3. **Toolbar** (right-aligned): `All stats ▾` (expands log to show FGM/FGA/3PA/FTM/FTA/STL/BLK/TOV) · `Sort: Date ↓`.
4. **Splits table** — stacked split-averages with grouped section bands:
   - All splits (highlighted row)
   - Location: Home · Road
   - Opponent context: vs Upcoming · vs Division · vs Conference · vs Top-10 Def
   - Role: Started · Bench
   - Rest: 0 days (B2B) · 1 · 2 · 3+
   - Recent form: Last 5 · Last 10 · Last 20
   - Columns: Split · GP · Min · Pts · 3pm · Reb · Ast · Pra · Pr · Pa · Ra · Fg% · 3p% · Ft%.
   - Click any row → applies as filter on the game log below.
5. **Game log table** — same columns as Splits (minus GP, plus Date and Opp):
   - Date · Opp · Min · Pts · 3pm · Reb · Ast · Pra · Pr · Pa · Ra.
   - With All stats: + FGM · FGA · 3PA · FTM · FTA · STL · BLK · TOV.
   - MIN formatted `*36:12` where `*` indicates starter (accent color).
   - REB shown as `actual-chances` (e.g. `8-12`).
   - AST shown as `actual-potential` (e.g. `9-14`).
   - Over-the-line cells in mint (`--pos`), under in rose (`--neg`).
   - DNP rows at opacity 55%, with reason in the row.
   - Row click → `/nba/game/[gameId]`.
   - Sticky table header on long ranges.

**Removed from default render**: grading panels, signal glyphs, EV/tier columns, grade badges. Components stay in repo.

**Smart chip — vs Upcoming**: when the player has a scheduled next game, the chip auto-populates `vs Team = <next opponent>`. Highlighted in the filter bar when applied. If no upcoming game, chip is disabled.

### Game Log (`app/nba/game/[gameId]/page.tsx`)

Stacked sections under a sticky anchor nav. State machine on `game.status`.

**Scoreboard** (always visible at top):

- Pregame: tip time + arena, sky-blue tint, no scores.
- Live: pulse-dot live indicator, current Q + clock, score-by-quarter strip.
- Final: gray "final" state, final scores, full Q strip.
- Postponed: pill on scoreboard, pregame-style layout.

**Anchor nav** (sticky): `Box score · Play-by-play · Team stats`.

- Pregame: `Box score · Team stats` only (PBP hidden until tip).
- Lineups tab is **not in the nav** — the box score covers the same data.

**Box score section**:

- Section bar has two pills: state pill (`live`, `pregame`, `final`) and lineup-status pill (`starters probable` amber, `starters confirmed` green; live state replaces this with `live · this game`).
- View toolbar above the box scores:
  - Segmented control: `Full rosters` (default) · `On court only`.
  - Checkbox: `Hide players who haven't entered`.
  - Both controls disabled pre-tip.
  - URL-synced: `?view=oncourt&hideUnused=1`.
- Per-team box score, side-by-side ≥980px, stacked vertically <980px.
- Within each team: groups `Starters` · `Bench` · `Inactive`.
- Bench order depends on state:
  - Pregame: most-used rotation by season minutes.
  - Live / final: re-ordered by entry (first sub → top), numbered `1.`, `2.`, `3.` in the player column.
- Inactive group always at bottom with reason text.
- `●` (mint dot) in a mark column + tinted row background for players currently on court (live only).
- `*` marker on starters.
- Columns:
  - Pregame: `Gp · Min · Pts · 3pm · Reb · Ast · Pra · Pr · Pa · Ra` (season averages).
  - Live / final: `Min · Pts · 3pm · Reb · Ast · Pra · Pr · Pa · Ra` (current game).
- Subtotal row at the bottom of each team (live / final only).
- Empty-state: pregame with no projected lineup → "Lineup not yet posted by NBA" + refresh timestamp.

**Play-by-play section** (live / final):

- Scrolling log inside the section card.
- Recent-first, color-coded events (scoring = accent, turnovers = neg).
- Click event → seeks the table if/when video integration ever lands (out of scope today).

**Team stats section**:

- KPI grid: FG% · 3P% · FT% · Reb · Ast · TOV · Pts in paint · Fast break.
- Each KPI is a small card with team-vs-team values and a split-bar visualization.

**Mobile / narrow** (<980px): box scores stack vertically; KPI grid collapses to 2 columns; PBP scrolls inside.

## Data flow / API surface

### New routes

| Route                                 | Purpose                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------- |
| `/api/players/active-today?sport=nba` | Players in tonight's lineups; powers Players tab "Playing today"                                               |
| `/api/player/[id]/upcoming`           | Next scheduled game (date / opp / time); drives "Next vs DEN" link + "vs Upcoming" smart chip                  |
| `/api/player/[id]/splits`             | Pre-aggregated season averages grouped by location · opponent · role · rest · recent form; drives Splits table |
| `/api/game/[id]/lineup-status`        | Returns `probable                                                                                              | confirmed | locked`; drives pill on Game Log section bar |
| `/api/game/[id]/on-court`             | Current 5v5 per team (live only); drives `●` dot and "On court only" view                                      |

### Extended routes

| Route                      | Change                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/api/player/[id]/history` | Add params: `range, vs, ha, starter, minGt, wl, oppRank, rest, b2b, spread, total`. Response: `{ averages, rows[] }` |
| `/api/games/today`         | Confirm `?sport=nba                                                                                                  | mlb` filter (per-sport counts already returned — verify it accepts the param) |
| `/api/boxscore`            | Pregame state returns season averages instead of game stats; bench ordered by entry once live                        |

### Kept (no change)

`/api/search`, `/api/roster`, `/api/scoreboard`, `/api/live`, `/api/live-boxscore`, `/api/live-props`, `/api/refresh-*`, `/api/contextual`, `/api/team-averages`, `/api/team-players`, `/api/matchup-grid`, `/api/workflow-runs`, `/api/auth/*`, `/api/admin/*`, `/api/flags`, `/api/mlb-*`, `/api/fish-sync`, `/api/ping`.

### Unlinked (still respond; UI no longer reads them on default pages)

`/api/grades/*`, `/api/player-grades`, `/api/game-grades`, `/api/player-props`, `/api/tier-grid`, `/api/tier-accuracy-daily`, `/api/calibration-buckets`, `/api/game-supplemental`, `/api/grades/top`, `/api/mlb-ev`, `/api/mlb-proj`, `/api/mlb-bvp`, `/api/mlb-pitcher`, `/api/mlb-atbats`.

Admin-only deep links (e.g. `/nba/grades`) continue to call these.

## Feature flags

`common.feature_flags` table; existing `isPageVisible()` cascade with admin-cookie bypass (`sb_unlock=go`).

Set to `false` (admin cookie bypasses):

- `page.nba.grades`
- `page.nba.player.props`
- `page.mlb.proj`, `page.mlb.ev`, `page.mlb.vs`, `page.mlb.pitcher`
- `sport.nfl`
- `page.lol`, `page.transparency`

Set to `false` globally (no admin bypass for structural reasons):

- `home.top_grades_column` (**new flag**) — HomeHub structure decision applies to everyone including admin.

Untouched:

- `page.fish` — leave at its current DB value; do not set anything.
- `sport.nba`, `sport.mlb` — stay `true`.
- `page.nba.games`, `page.nba.player`, `page.mlb.games`, `page.mlb.player` — stay `true`.
- `admin.*` — unchanged.

### Public vs admin visibility matrix

| Surface                               | Public                               | Admin                                                   |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| `/` HomeHub                           | 2 sport cards, no grades column      | 2 sport cards, no grades column                         |
| `/nba`                                | Games · Players tabs                 | Games · Players tabs                                    |
| `/nba/grades`                         | `<ComingSoon />`                     | Full PropMatrix                                         |
| `/nba/player/[id]/props`              | `<ComingSoon />`                     | Full prop matrix                                        |
| `/nba/player/[id]`                    | Player Log (no grade badges)         | Same as public (signal panels gone from default render) |
| `/mlb/proj`, `/ev`, `/vs`, `/pitcher` | `<ComingSoon />`                     | Existing MLB views                                      |
| `/nfl`, `/lol`, `/transparency`       | `<ComingSoon />`                     | Existing pages                                          |
| `/api/grades/*` etc.                  | Routes respond; UI doesn't call them | Routes respond; admin pages call them                   |
| `/fish`                               | Page renders as-is                   | Page renders as-is                                      |

## Grading — parallel diagnostic

Hide via flags above. In parallel, run a one-session diagnostic to determine if the skew is a quick fix or a calibration rebuild:

1. Pull 20 most-outrageous recent grades from `common.daily_grades` (top + bottom by `grade`). Spot-check each against the player's log over the window.
2. `SELECT model_version, MIN(grade_date), MAX(grade_date), COUNT(*) FROM common.daily_grades GROUP BY model_version` — any stale deprecated model_version rows still rendering?
3. Constants check in `grading/grade_props.py`: `KDE_THIN_SAMPLE_PROB_CAP = 0.85`, calibrator `n >= 30`, logistic `n >= 50` per `.claude/rules/grading.md`.
4. `SELECT bucket_min, bucket_max, sample_size, empirical_hit_rate, isotonic_hit_rate FROM common.grade_calibration WHERE sample_size < 30` — buckets that shouldn't be qualifying.
5. `SELECT grade, composite_grade, trend_grade, regression_grade, momentum_grade FROM common.daily_grades WHERE ABS(grade) > 80` — which subgrade is pulling the composite outrageous?
6. Spot-check 5 high-EV rows: does implied probability from `over_price` + weighted hit-rate produce the displayed EV%? Stale lines + fresh stats inflate EV.
7. Run `/skill regenerate-health` to surface integrity-layer state.
8. Output: short findings doc at `docs/superpowers/specs/<diagnostic-date>-grading-skew-diagnostic.md` — verdict is quick-fix, calibration-rebuild, or hide-indefinitely.

Diagnostic is independent of the redesign. Can run before, during, or after.

## Migration plan

Eight sessions, ordered. Each session ends with a routine commit + MEMORY.md note per CLAUDE.md ceremony tier.

1. **Flag flip + HomeHub redesign** (~2h) — SQL upserts for the eight flags. Rewrite `app/HomeHub.tsx` and `app/page.tsx`. Trim top nav to Home · NBA · MLB · Admin.
2. **NBA tabbed index + Player Log shell** (~3-4h) — `NbaPageInner` rewrite with Tabs. Games tab grouped by status. Players tab with search / recent / playing-today. Player Log header + filter bar + log table. Reuse existing `/api/player/[id]/history` for v1.
3. **Player Log Splits table** (~3h) — `/api/player/[id]/splits` route. `PlayerSplitsTable` component above the game log. Click-row-as-filter.
4. **Extended filters + smart chips** (~3h) — Extend `/api/player/[id]/history` with 11 filter params. `PlayerLogFilters` with inline-expand pickers. `/api/player/[id]/upcoming` + "vs Upcoming" wiring. URL-sync filters.
5. **Game Log redesign** (~4h) — `app/nba/game/[gameId]/page.tsx`. Scoreboard + anchor nav + full-roster box score + view toolbar + state machine. `/api/game/[id]/lineup-status` + `/api/game/[id]/on-court`. Responsive stacking <980px.
6. **Responsive + mobile bottom-sheet filters** (~2-3h) — Add `@radix-ui/react-dialog`. `PlayerLogFiltersMobile`. Media-query branching. Lighthouse pass.
7. **MLB parity** (~3-4h) — Mirror NBA structure on `/mlb`. Players tab role-filter (Pitchers / Batters / All). Game Log MLB-specific tabs (Box · At-bats · Pitches). Splits relevant to MLB (vs LHP/RHP, day/night, etc.).
8. **QA + polish + rollout** (~2-3h) — Manual QA matrix. Admin-bypass verification on every hidden route. Polish (typography, spacing, animations). Flip flags in production via `/admin`.

The grading diagnostic runs in parallel; it can drop in at any point.

## Error handling

- **API failures** — existing SWR pattern: skeleton + retry button per card / table.
- **Empty data** — Player Log with no games matching filters shows "No games match these filters" + Clear all link. Box score pregame with no projected lineup shows "Lineup not yet posted by NBA" + refresh timestamp.
- **Stale lineup data** — confirmed/probable pill carries a timestamp; if older than 2h before tip, render amber-warning variant of the pill.
- **Flag DB unreachable** — `loadFlags()` already returns cache or empty; missing keys treated as enabled. No change.
- **Race conditions on live polls** — SWR `refreshInterval: 30_000`, `revalidateOnFocus: false`, `dedupingInterval: 15_000` per `.claude/rules/web.md`.
- **`/fish` link inadvertently introduced** — discovered during QA, blocks the rollout. Add a manual checklist line in step 8.

## Testing

No automated tests exist in the repo today. Manual QA matrix per session:

- **Smoke** after each session: `/` · `/nba` · `/nba?tab=players` · `/nba/player/2544` · `/nba/game/0022400847` · `/mlb` · `/admin`. Console clean.
- **tsc** on every commit (existing PostToolUse hook).
- **ruff** on Python edits (existing PostToolUse hook).
- **Admin-bypass verification** — set `sb_unlock=go` cookie, confirm `/nba/grades`, `/nfl`, `/lol`, `/transparency`, `/mlb/proj`, etc. still render.
- **Flag verification** — flip `page.nba.grades` in `/admin`, confirm 60s cache TTL invalidates, confirm cascade rules per `lib/feature-flags.ts`.
- **Responsive QA** — manual checks at 360px (phone), 768px (tablet), 980px (split breakpoint), 1280px (desktop), 1920px (wide).
- **`/fish` integrity** — visit `schnapp.bet/fish` directly, confirm page identical to pre-redesign. Confirm no anchor anywhere in the app links to it.
- **Rollback** — every step reverts via `git revert` + flag re-flip. Grading code untouched throughout; re-enabling is a flag flip + nav edit.

## Design tokens

```
--bg          #0b0f14    canvas
--bg-soft     #11161d    table head, popovers
--bg-card     #141a23    cards, chips
--bg-panel    #0f141b    filter card, secondary panels
--line        #1e2632    primary borders
--line-soft   #1a2129    table row dividers
--ink         #e6edf3    primary text
--ink-dim     #8b97a8    labels, muted text
--ink-deep    #4a5566    disabled, DNP
--accent      #7dd3fc    sky-300 — single sharp accent
--accent-soft rgba(125,211,252,.12)
--accent-line rgba(125,211,252,.35)
--pos         #86efac    mint — over the line, on-court
--neg         #fda4af    rose — under the line
--warn        #fcd34d    amber — attention, probable lineups
--live        #f87171    red — live state
```

Typography: `JetBrains Mono` (with `IBM Plex Mono` fallback) for all numeric and chrome text. `tnum` + `lnum` + `ss01` font features. Antialiased.

Backgrounds: two radial gradients on `body` for atmospheric depth — sky-tinted top-right, amber-tinted bottom-left (or live-tinted bottom-left on Game Log).

No icons except HTML entities (`▾`, `→`, `·`, `●`, `*`). No shadows on chrome. No gradients on cards.

## Known modifications pending implementation

Captured during brainstorming, deferred to design execution:

- HomeHub cards may need sport-color accents and a live-game ticker treatment (user feedback: "looks a little bland").
- Player Log Splits table needs minor row-tinting + spacing adjustments (user feedback: "needs some modifications but works for now").
- Mobile box score narrow preview in the spec mock truncated rosters for clarity; real implementation lists every player.
- **Filter bar should also filter the Splits table** (user feedback during Session 5 verification). Currently `PlayerLogFilters` URL params only narrow the game log table; splits remain whole-season. Wire the same predicates (range / vs / ha / starter / minGt / b2b / rest) into the splits route or recompute groups client-side from the filtered row set. Defer until other Session 5 work lands.

## Open questions

- Should pregame "Has not entered" rows render at all once tip happens, before the player has subbed in? Current spec: yes, listed in entry-order group as "Has not entered", hidden when the `Hide unused` checkbox is on.
- Should `/api/players/active-today` come from a new endpoint or extend `/api/team-players`? Decision deferred to step 2.
- Should the splits-table-as-filter behavior also write to URL state, or only set transient filter state? Default to URL state (deep-linkable).
- MLB-specific splits content (vs LHP/RHP, day/night, opposing bullpen, etc.) needs a small scoping pass in step 7 before implementation.

## Reversibility

Every step is reversible:

- Flag flip → flip back via `/admin`. Caches invalidate in 60s.
- New route → `git revert` the commit. Old route is untouched.
- Renamed component → component name is the only contract; revert the rename.
- Grading code is untouched throughout. Re-enabling grading is `UPDATE common.feature_flags SET enabled=1 WHERE flag_key='page.nba.grades'` (and the related flags) plus a nav-link edit.
