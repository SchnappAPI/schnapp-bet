---
name: project-session8-handoff
description: State at end of Session 7 MLB parity work — all MLB UI tasks complete, Session 8 = QA + polish + /deploy
metadata:
  type: project
---

Sessions 1–7 complete (commit 0360efd). MLB parity fully shipped.

**Why:** App-simplification redesign spec (docs/superpowers/specs/2026-05-24-app-simplification-design.md). Session 7 finished with MLB API routes + MLB UI parity.

**How to apply:** Session 8 = QA + polish + `/deploy`.

## What shipped in Session 7

### API layer (commit 7bb0ceb)

- `/api/mlb/game/[gamePk]` — scoreboard metadata
- `/api/mlb/player/[playerId]/log` — batting game log with range/ha/pitcherHand filters
- `/api/mlb/player/[playerId]/splits` — splits groups (All, Location, Pitcher hand, Recent)

### UI layer (commit 0360efd)

- `MlbPageInner.tsx` — rewritten: Games/Players tabs, game cards as Links to `/mlb/game/[gamePk]`, grouped Live/Scheduled/Final; Players tab with All/Batters/Pitchers role chips + command palette + recent list
- `/mlb/game/[gamePk]` — new route: scoreboard header + MlbGameTabs
- `/mlb/player/[playerId]` — new route: Range/H-A/pitcherHand URL filters, splits table, game log; saves `schnapp_recent_mlb_players` localStorage
- `CommandPalette.tsx` — MLB games route to `/mlb/game/[id]` instead of `?view=game`

## Known data quality

- `pitcher_hand` NULL in DB for most games (MLB ETL pending). Splits "Pitcher hand" group only appears when data exists.

## Session 8 checklist

- [ ] Browser smoke: /mlb Games tab date nav, game cards link to /mlb/game/[gamePk]
- [ ] Browser smoke: /mlb Players tab role filter, command palette search, recent list
- [ ] Browser smoke: /mlb/game/777978 — scoreboard header + MlbGameTabs tabs
- [ ] Browser smoke: /mlb/player/669364 (Xavier Edwards, MIA) — splits + log + filter chips
- [ ] Verify recent players saves to localStorage on player page visit
- [ ] `/deploy`
