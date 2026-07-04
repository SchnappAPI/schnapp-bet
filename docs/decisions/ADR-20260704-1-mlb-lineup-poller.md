# ADR-20260704-1: MLB intraday lineup poller — facts in the DB, projections at read time

Date: 2026-07-04

## Context

The MLB web surface is being expanded around upcoming games: projected
lineups with windowed per-batter averages (last 5/10/20, split by the
opposing starter's hand), a Statcast exit-velocity log per player, and
game-log filtering against the upcoming pitcher. Two data gaps blocked all
of it:

1. For scheduled games, `mlb.games.away/home_pitcher_id` was NULL and
   `*_pitcher_hand` was hardcoded NULL for every game, so nothing downstream
   (web vs-hand filters, `compute_mlb_projections._platoon_factor`) ever saw
   a pitcher hand.
2. Nothing in the stack captured pre-game lineups. `etl/lineup_poll.py` is
   NBA-only; confirmed MLB lineups only became visible after the game via
   `mlb.batting_stats`. The grading tier's `mlb.batter_context` carries a
   recent-appearance heuristic pool, not a real lineup.

Confirmed MLB lineups post to the MLB Stats API roughly 1-4 hours before
first pitch and are exposed by a single schedule call with the
`probablePitcher,lineups` hydrate.

## Decision

1. **New intraday poller `etl/mlb_lineup_poll.py`** runs every 30 minutes
   through the daily game window (`mlb-lineups.yml`, self-hosted mac-runner,
   early-exit when `mlb.games` has no non-final games today). One hydrated
   schedule call per run covers all games.
2. **New table `mlb.daily_lineups`** (PK `game_pk, team_id, player_id`;
   `batting_order`, `position`, `is_confirmed`, `source`, `updated_at`)
   stores **confirmed lineups only**. Write pattern is DELETE-per-game/team
   then upsert of exactly nine rows, so scratches and re-posts converge.
   DDL is owned by the poller script (guarded CREATE), per the mlb.*
   convention. The table enters `CRITICAL_FIELDS`.
3. **Facts in the DB, projections at read time.** The web lineups endpoint
   falls back to a recent-batting-order heuristic labeled "Projected" when
   no confirmed rows exist yet; that heuristic is computed at read time and
   never written to `mlb.daily_lineups`. This keeps the table append-clean
   and makes "confirmed" unambiguous for grading reuse later.
4. **Probable pitcher updates are targeted UPDATEs, not row upserts.** The
   poller only touches the four pitcher id/name columns (COALESCE, so a
   hydrate dropout never nulls a known pitcher) plus a set-based hand fix
   from `mlb.players.pitch_hand` scoped to today. The nightly `mlb_etl.py`
   ends with the same hand self-heal across all rows, repairing the
   full-column MERGE that the box-score loader performs and backfilling
   historical finals.

## Consequences

- Web can show real lineups pre-game with a Confirmed/Projected chip, and
  windowed vs-hand averages become computable because historical and
  same-day games now carry starter hands.
- `compute_mlb_projections.py`'s platoon factor activates with zero code
  change once hands populate.
- ~26 short mac-runner Actions runs/day during the season (30-min cadence,
  15:00-02:00 UTC); no-game days cost one DB query each run.
- A future step may point `compute_mlb_projections.fetch_confirmed_lineup`
  at `mlb.daily_lineups` to replace its post-hoc boxscore read; deliberately
  out of scope here.
