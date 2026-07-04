# MLB Web

**STATUS:** in development (not considered live). Route-per-page architecture per the
2026-05-24 app simplification: `/mlb` (games + player search), `/mlb/game/[gamePk]`
(Lineups / Box Score / Exit Velo tabs), `/mlb/player/[playerId]` (filterable game log,
splits, Statcast exit-velocity view), `/mlb/grades` (At-a-Glance). The pre-simplification
six-tab `?view=` page is retired; its view components (`MlbProjView`, `MlbVsView`,
`MlbEvView`, `MlbPlayerView`, `MlbPitcherView`) remain in the tree as unmounted reference
implementations only.

## Purpose

MLB pages implementing the product blueprint for baseball: browse the slate, open a game
pregame and see confirmed/projected lineups with windowed per-batter form (overall or vs
the probable SP's hand), then drill into a player for the full game log, splits, career
BvP vs the upcoming starter, and the per-at-bat Statcast exit-velocity log.

## Files

Live pages + components:

- `web/app/mlb/page.tsx` → `MlbPageInner.tsx` — date navigator, Games tab (Live /
  Scheduled / Final card groups; cards show probable pitchers with handedness), Players
  tab (role filter, ⌘K search, recent players)
- `web/app/mlb/game/[gamePk]/page.tsx` → `MlbGamePageInner.tsx` → `MlbGameTabs.tsx` —
  score header + three tabs. Non-final games default to **Lineups**; final games default
  to **Box Score**. The tab strip renders even when no box score exists yet
- `web/app/mlb/MlbLineupsTab.tsx` — Lineups tab. Probable pitcher cards (hand + season
  line), Confirmed/Projected chip per team, 9-row lineup tables with client-computed
  GP/AVG/OBP/SLG/HR/RBI/K% over an L5/L10/L20 window, optionally restricted to games vs
  the probable SP's hand. Platoon-edge bat-side highlight. Row click deep-links to the
  player page with `range` + `pitcherHand` preset
- `web/app/mlb/MlbGameTabs.tsx` — inline `Linescore`, `BatterTable`, `PitcherTable`,
  `ExitVeloTable` (Box Score + Exit Velo tabs, unchanged behavior)
- `web/app/mlb/statcastFormat.ts` — shared Statcast display helpers (`veloColor`,
  `resultColor`, `resultLabel`) and the ETL-matching stat definitions
  (`isHardHit` EV≥95, `isBarrel` EV≥95 AND 8≤LA≤32)
- `web/app/mlb/player/[playerId]/page.tsx` → `MlbPlayerPageInner.tsx` — header, Game
  Log / Statcast view switch (`?view=`), URL-synced filter bar (L5/L10/L20/Season,
  Home/Away, vs LHP/RHP, vs Upcoming SP), career-BvP strip vs the upcoming probable,
  splits table, game log
- `web/app/mlb/player/[playerId]/MlbStatcastSection.tsx` — Statcast view: summary tiles
  (batted balls, avg/max EV, hard-hit%, barrel%, avg xBA) over the filtered set +
  comprehensive per-at-bat exit velocity log with batted-balls-only toggle
- `web/app/mlb/grades/page.tsx` → `MlbGradesPageInner.tsx` — cross-slate grades browse
  with tier ladders (behind `page.mlb.grades`)

API routes (all direct `mssql` via `getPool`, no Flask):

- `web/app/api/mlb-games/route.ts` — day slate from `mlb.games` + `mlb.teams`, including
  probable pitcher name and hand. For today's slate, enriched by the statsapi live
  overlay (`web/lib/mlbLive.ts`): in-progress scores/status plus a `liveLabel`
  ("Top 5th"). The DB owns the list; the overlay never adds games and drops out
  silently on timeout (1.5s)
- `web/app/api/mlb/game/[gamePk]/route.ts` — single-game header context, plus the same
  live overlay for today's non-final games (returns `{ game, live }`)
- `web/app/api/mlb/game/[gamePk]/lineups/route.ts` — Lineups tab payload in one round
  trip: confirmed nine from `mlb.daily_lineups` (written intraday by
  `etl/mlb_lineup_poll.py`), or a read-time **projected** nine from recent hundreds
  batting orders when a team's lineup has not posted (`lineupStatus:
  confirmed|projected|unavailable`); per-batter current-season game rows tagged with the
  opposing starter's hand (so all window/hand toggles are client-side slices); probable
  pitcher season lines from `mlb.pitcher_season_stats`. ETag'd
- `web/app/api/mlb/player/[playerId]/log/route.ts` — season game log (one query, JS-side
  `range`/`ha`/`pitcherHand` filters) + averages + `upcoming` (next non-final game with
  opposing probable SP id/name/hand) + `bvp` (career line vs that pitcher)
- `web/app/api/mlb/player/[playerId]/splits/route.ts` — split groups (All / Location /
  Pitcher hand / Recent form)
- `web/app/api/mlb/player/[playerId]/atbats/route.ts` — per-at-bat Statcast rows for the
  current season from `mlb.player_at_bats` (opponent derived from `is_top_inning`,
  pitcher name/hand joined from `mlb.players`). Raw rows only; the client computes
  summary tiles over the filtered set. ETag'd
- `web/app/api/mlb-boxscore`, `mlb-linescore`, `mlb-atbats` — Box Score / Exit Velo tab
  payloads. `mlb-linescore` serves statsapi live innings while a game is in progress
  (pbp loads nightly), same response shape
- `web/app/api/mlb/grades/route.ts` — At-a-Glance payload
- Legacy routes backing the unmounted views (`mlb-proj`, `mlb-bvp`, `mlb-ev`,
  `mlb-player`, `mlb-pitcher`) still function but have no mounted consumers

## Key Concepts

### Live games and same-night finals

Status classification is shared in `web/app/mlb/gameStatus.ts` (pregame-state
allowlist; `mlb.games.game_status` holds 'F' or a statsapi detailedState). While a
game is live the list page, game header, and tabs repoll every 30s; scores/inning come
from the statsapi overlay server-side. Finals land in `mlb.games` the same night via
the game-day poller's `update_game_scores` step (see `etl/mlb_lineup_poll.py`); the
nightly ETL remains the reconciler.

### Pregame lineups (confirmed vs projected)

`mlb.daily_lineups` stores **confirmed lineups only** (facts), written by the intraday
poller (`mlb-lineups.yml`, every 30 min through the game window — ADR-20260704-1). The
lineups route derives a projected nine at read time (players with hundreds batting orders
in the team's last 10 games, regulars first, typical slot order) and labels it
`projected`. The UI shows a chip either way and flips automatically once the poller
captures the posted lineup.

### Windowed vs-hand batter form

The lineups payload ships each batter's current-season per-game rows tagged with that
game's opposing-starter hand (`CASE side WHEN 'H' THEN away_pitcher_hand ELSE
home_pitcher_hand END`). The L5/L10/L20 window and the vs-SP-hand restriction are pure
client-side slices — zero refetch on toggle, per the connected-visual/one-round-trip rule
(ADR-20260420-2). Historical hands exist because `mlb_etl.update_pitcher_hands` backfills
`mlb.games.*_pitcher_hand` from `mlb.players.pitch_hand` every nightly run.

### Player Statcast view

`?view=statcast` on the player page swaps the splits+log for the exit-velocity view. The
page-level `range` and `pitcherHand` filters apply to both views (for Statcast, `range`
means last-N distinct games). Hard-hit and barrel percentages use the same definitions as
`mlb.player_trend_stats` (see `statcastFormat.ts`) so tiles agree with trend data.

### Timezone

`MlbPageInner.todayLocal()` is browser-local; `mlb-games/route.ts:todayCT()` defaults the
API to Central Time. The URL query takes precedence once a date is explicitly selected.

## Invariants

Do not revert without an ADR.

- Route-per-page: `/mlb`, `/mlb/game/[gamePk]`, `/mlb/player/[playerId]`, `/mlb/grades`.
  The retired `?view=` switcher must not come back; the unmounted view files are
  reference-only and must not be re-imported by pages
- URL is the source of truth for player-page filters (`range`, `ha`, `pitcherHand`,
  `view`) — API and client apply the same filter semantics
- Lineups/Box Score/Exit Velo tab strip renders regardless of box-score availability;
  each tab degrades with its own message
- `mlb.daily_lineups` holds confirmed lineups only; projected lineups are derived at read
  time and never written (ADR-20260704-1)
- Web hard-hit/barrel math lives in `statcastFormat.ts` and must mirror
  `etl/mlb_play_by_play.py` (hard-hit EV≥95; barrel EV≥95 AND 8≤LA≤32). If the ETL
  definitions change, change both
- Starting pitchers come from `mlb.pitching_stats.note = 'SP'` (postgame) or
  `mlb.games.*_pitcher_id` (pregame probables). Starting batters postgame come from
  `mlb.batting_stats` where `batting_order % 100 = 0`
- IP display uses MLB notation (`.1` = 1 out, `.2` = 2 outs), never decimal thirds
- `/api/mlb/player/[playerId]/atbats` and `/api/mlb-atbats` read `mlb.player_at_bats`,
  never `mlb.play_by_play`, and join `mlb.players` at read time for names
- MLB shares no components with NBA. If something feels reusable, put it under
  `/web/_shared/` first

## Recent Changes

Git log is the changelog (ADR-20260517-4): `git log --grep='\[mlb\]'`.

## Open Questions

- Whether to add a Pitch Log sub-tab under Box Score (data already in `mlb.play_by_play`)
- Whether the lineup rows should also surface Statcast quality (avg EV / hard-hit% /
  barrel%) or BvP-vs-probable columns behind a column toggle
- Whether `compute_mlb_projections.fetch_confirmed_lineup` should read
  `mlb.daily_lineups` pregame instead of waiting for boxscore rows (noted in
  ADR-20260704-1 as a future step)
- Whether to surface the exact Statcast barrel definition (needs an ETL-side flag column)
- Whether to pull 2023-2025 historical games into PBP as a one-time backfill
