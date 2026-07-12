# ADR-20260712-3 — Streak/drought conditional-frequency layer + transparency

Date: 2026-07-12
Status: Accepted

## Context

Two owner problems (design spec:
`docs/superpowers/specs/2026-07-12-streaks-trends-transparency-design.md`):

1. **Trust.** The odds-free projection board reads near-identical day over day,
   so it is hard to believe it is doing anything. The projection is a
   slow-moving per-player rate; nothing on the board reflects the player's
   live game-state.
2. **Accountability.** No per-day view of whether the board's tiers actually
   hit.

The owner wanted, per player and per market, the empirical frequency of the
next-game outcome given the player's _current run-state_ — e.g. "on a 2-game HR
streak, how often did a 3rd follow" or "15-game hit streak, never reached 16."
Not a model — the literal conditional frequency, with the denominator shown, so
a hot player at their ceiling (negative regression) and an overdue cold player
(positive regression) both surface from the same object.

## Decision

1. **One engine, not a set of pattern detectors.** For each (player, market,
   scope), the conditional next-game frequency given the current run-state
   (streak d = d straight games with the event; drought g = g straight without)
   = `n_event_next / n_reached`, denominator always carried. Every requested
   pattern — back-to-back, the streak ceiling, drought-break, the
   HR-then-N-dry cadence — is one instance. Cadence early/late falls out of the
   drought-length break-rate curve (typical gap = its mode); no separate
   periodic detector.

2. **Event definitions** (binary per game, over the deduped batting line —
   max plate_appearances per game_pk+player_id, matching the props board and
   outcome settlement): HR (`home_runs>=1`), HIT (`hits>=1`), HRR2
   (`h+r+rbi>=2`), HRR3 (`>=3`), RBI (`rbi>=1`). Total bases excluded from
   streaks: `total_bases>=1` iff `hits>=1`, so a TB streak is a hit streak.

3. **Run-state is within-season** (streaks reset each season). The **career**
   scope pools the within-season transition counts across all loaded seasons;
   season and career are shown side by side.

4. **Leakage** matches the existing `player_patterns` convention: the state row
   for date D is through-D-inclusive; readers use the latest row strictly
   before the projected game (`< D`), and further require it within 14 days of
   the slate so a stale prior-stint run-state never shows.

5. **Two tables** (`etl/mlb_play_by_play.py`, nightly + `--rebuild-streaks`):
   `mlb.player_streak_state` (one row per batter/date/market — the current
   state and its resolved conditional frequency, retained per as-of for the
   board's historical rows) and `mlb.player_streak_dist` (the full
   streak/drought curve, latest-only per batter, for the trends page).

6. **Three surfaces**: a Situation column on `/mlb/props` (current state +
   k/N, reads differently each day — the trust fix); a new `/mlb/streaks` page
   (slate scan lists: at-ceiling/fade, overdue/due, hot extenders + per-player
   curves); a new `/mlb/transparency` tab (per-day settled hit rate by tier and
   market off the odds-free board — works despite the dead odds key, and
   complements the model-side weekly `grade_calibration_history`).

7. **Display/context only.** These empirical frequencies are never folded into
   the projection or the tier lines; the denominator is always visible so a
   small-n rate cannot masquerade as a calibrated model output.

## Consequences

- The props board now carries a live, game-state-dependent reason per row, and
  the streaks page ranks the slate by the regression signals the owner
  described. Verified end-to-end: Judge at a 6-game HR drought reads season 0/2,
  career 7/20 (35%); his HR streak curve is 34/95 back-to-back → 8/34 → 3/8.
- The transparency tab makes the board's daily tier ordering observable
  (e.g. Elite 67% vs Fade 12% on a settled day).
- Nightly cost: one more materializer in the pbp flush loop, plus a
  once-through-history rebuild. The trends `player_streak_dist` is latest-only
  to bound size (~116k rows vs the ~30M a per-as-of retention would need).
- `mlb.player_patterns` (HR-only, early/late) is superseded in concept by this
  generalized engine but left in place until the player-page reads migrate.

## Out of scope

- Folding any frequency into the projection.
- Pitcher and non-listed markets in the streak layer.
- The EV>99 cold-but-rising-quality overlay (owner deferred).
- Pitcher-strikeouts analytic sharpening (separate track, ADR-20260712-2 lineage).
