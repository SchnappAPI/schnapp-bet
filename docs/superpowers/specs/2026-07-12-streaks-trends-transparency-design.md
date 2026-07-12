# Streaks/Trends patterns + Transparency tab — design

Date: 2026-07-12. Status: draft for owner review.

Owner goal (two problems):

1. **Trust.** The projection board reads near-identical day over day, so it is
   hard to believe it is doing anything. Fix: surface game-state-dependent,
   player-specific context that changes every day and gives a concrete reason a
   pick is live _today_.
2. **Accountability.** A transparency tab showing per-day settled performance.

The patterns work is a **display/context layer only**. It does NOT feed the
projection probability (mlb-v1.2) or the tier lines. The model stays untouched;
this tells the user what the player has actually done from exactly the spot they
are in now.

## 1. The one engine: conditional next-game frequency given run-state

For a player, a market, and a scope, walk the game log in date order. Before
each game, record the player's **run-state** for that market's binary event:

- **streak d** — d consecutive prior games _with_ the event, or
- **drought g** — g consecutive prior games _without_ it.

Exactly one of (streak, drought) is > 0 for any game after the first
event/non-event. The conditional frequency the owner wants is:

> Of all the times this player was in this exact state, how often did the event
> happen the next game = `n_event_next / n_reached`, with `n_reached` (the
> denominator) always shown.

Every example the owner gave is one instance of this:

| owner example                    | state today   | readout                                         |
| -------------------------------- | ------------- | ----------------------------------------------- |
| back-to-back HR, is a 3rd coming | HR streak 2   | reached streak 2: N; extended to 3: k (k/N)     |
| 15-game hit streak, never 16     | hit streak 15 | reached 15: 5; extended to 16: 0 (0%) — ceiling |
| no HR in 3 games                 | HR drought 3  | had drought 3: N; broke next: k (k/N)           |
| HR-then-4-dry-then-HR cadence    | HR drought 4  | drought-4 break rate peaks → "on-pattern" tag   |

The negative-regression signal (hot, at ceiling → don't chase) and the
positive-regression signal (overdue vs own cadence → due) both fall out of the
same table; no separate detectors.

### Event definitions (binary, per game)

| market | event                    | notes                             |
| ------ | ------------------------ | --------------------------------- |
| HR     | `home_runs >= 1`         |                                   |
| hit    | `hits >= 1`              |                                   |
| HRR2   | `hits + runs + rbi >= 2` | the prop board's H+R+RBI line     |
| HRR3   | `hits + runs + rbi >= 3` | separate, per owner's "3 or more" |
| RBI    | `rbi >= 1`               |                                   |

**Total bases is intentionally excluded from streaks**: `total_bases >= 1` iff
`hits >= 1`, so a TB streak is identical to a hit streak. TB stays a projection
market only.

### Cadence phase (early / on / late)

The drought-length break-rate curve already encodes cadence — the typical gap is
where the break rate concentrates. Define `typical_gap` = the drought length
with the most historical occurrences that also broke (mode of realized gaps,
min-sample guarded). Tag the current drought g:

- `g < typical_gap` → **early** ("pattern coming")
- `g == typical_gap` → **on-pattern** ("due")
- `g > typical_gap` → **late** ("overdue")

### Scope (two values, side by side)

- **season** — current season only.
- **career** — current + all prior loaded seasons rolled in.

Both computed and shown. Season is the primary; career backstops thin
current-season samples.

### Leakage safety

All states use games **strictly before** the as-of game (same
through-date-exclusive rule as `fetch_trend` / the existing
`mlb.player_patterns`). The as-of row for date D uses only games with
`game_date < D`.

## 2. Data layer

Two materialized tables (nightly, in `etl/mlb_play_by_play.py`, beside the
existing `player_patterns` build which this supersedes for the generalized case;
`player_patterns` stays until the web reads migrate).

### `mlb.player_streak_state` — one row per (batter, as_of_date, market)

The current situation + its frequency, for the props row and player page.

```
batter_id, as_of_date, market,
season,
cur_state          VARCHAR(8)   -- 'streak' | 'drought' | 'none'
cur_len            INT          -- d or g
streak_ceiling     INT          -- max event-streak ever reached (season)
streak_ceiling_car INT          -- ... career
typical_gap        INT          -- season cadence
phase              VARCHAR(8)    -- 'early' | 'on' | 'late' | NULL (streak state)
-- current-state conditional frequency, both scopes:
season_n           INT          -- times reached this exact state (season)
season_hits        INT          -- of those, event happened next game
season_freq        DECIMAL(5,3)
career_n           INT
career_hits        INT
career_freq        DECIMAL(5,3)
at_ceiling         BIT           -- cur_state='streak' AND cur_len = streak_ceiling
created_at
PK (batter_id, as_of_date, market)
```

### `mlb.player_streak_dist` — the full curve, for the trends page

```
batter_id, as_of_date, market, scope ('season'|'career'),
state_type ('streak'|'drought'), state_len,
n_reached, n_event_next, freq DECIMAL(5,3),
created_at
PK (batter_id, as_of_date, market, scope, state_type, state_len)
```

`player_streak_state` is derivable from `player_streak_dist` + the current
run-state, but is materialized separately so the hot read path (props row) is a
single-row point lookup, not an aggregate.

### Transparency source — no new table

The odds-free props board (`mlb.batter_prop_projections`) already self-grades
each past row against the realized outcome (played/hit, per the board's existing
LEFT JOIN). Per-day transparency aggregates that: for each past `as_of_date`,
group settled projections by market and tier, compute hit rate vs the tier's
claimed probability. Read-time aggregation in the API route; no materialization
needed unless it proves slow.

## 3. ETL

`etl/mlb_play_by_play.py` gains a `rebuild_streaks` step (flag +
`--rebuild-streaks`, mirroring `--rebuild-patterns`). For each batter, per
market, per as-of date in the incremental window:

1. Pull the leakage-safe game log (deduped `batting_stats` max-PA row per
   game, ascending).
2. Compute the pre-game run-state series (streak/drought at each game) and the
   realized next-game event.
3. Aggregate into the distribution (per state_type × state_len: n_reached,
   n_event_next) for season and career scopes.
4. Emit `player_streak_dist` rows and the single `player_streak_state` row for
   the current (latest) state.

Same nullable-int / FLOAT-staging gotchas already documented in the patterns
build apply. MERGE-idempotent; no skip-if-exists (through-date-inclusive rows
must recompute across doubleheader flush boundaries — same rationale as
`player_patterns`).

Cadence: folded into the 09:30 UTC pbp workflow, after the existing pattern
build. Add a safety-net cron tick (the 2026-07-12 dropped-schedule lesson).

## 4. Surfaces

### A. Props board rows (`/mlb/props`) — the trust fix

Each row gains a **situation cell** per market: the current state + its season
frequency with denominator + a ceiling/overdue flag. Examples rendered:

- `HR streak 2 · 3rd: 4/8 (50%)` with a ↑ chip
- `hit streak 15 · 16th: 0/5 (0%)` with a ceiling ⚠ chip (don't chase)
- `HR drought 4 · on-pattern · breaks 6/9 (67%)` with a "due" chip

Career value shown on hover / expand. The chip vocabulary: `at-ceiling`
(negative regression), `overdue`/`on-pattern` (positive regression),
`extending` (streak below ceiling). Purely from `player_streak_state`.

### B. Streaks/Trends page (`/mlb/streaks`) — new

- Per player, per market: the full streak-extension curve and drought-break
  curve (from `player_streak_dist`), season and career toggle. A small chart
  (freq vs state_len) + the raw n at each length.
- Board-level lists for today's slate, sortable/filterable:
  - **At ceiling** (hot, continuation unprecedented → fade)
  - **Overdue vs cadence** (cold past typical gap → due)
  - **Strong back-to-back rate + just did it** (the owner's "hit a HR, they
    hit back-to-back often" scan)
- Every row links to the player page and carries the denominator.

### C. Transparency tab (`/mlb/transparency`) — new

Per-day settled performance of the props board:

- A day-by-day table: date, # projections settled, overall hit rate, and hit
  rate per tier (Elite/Strong/AboveAvg/Average/Fade) vs the tier's target, per
  market (HR / hits / HRR).
- A calibration-style readout: did the top tier actually hit more than the
  bottom tier, day over day. This is the "is it working" the owner asked for,
  and it complements the weekly `grade_calibration_history` (which is model-side;
  this is board-side and daily).
- Trend line of hit rate over time.

## 5. What stays out of the model

- No change to `batter_prop_projections` probabilities, the analytic tier engine
  (mlb-v1.2), or the calibrators. Patterns are context, shown with denominators,
  never blended into a projection.
- The frequencies are raw empirical counts, not calibrated — the denominator is
  always displayed so a 1/2 never masquerades as 50% signal.

## 6. Verification

- Unit: run-state computation on a hand-built game log (known streaks/droughts,
  ceiling, gap) → exact n/hits per state; leakage check (no game_date >= as_of
  contributes).
- Spot-check a known player against a manual box-score count for one date.
- ETL dry-run on the Mac against the live DB; row counts sane; MERGE idempotent.
- Web: props row renders the situation cell; streaks page curves match the
  table; transparency day totals reconcile with a direct SQL count.

## 7. Out of scope (this spec)

- Pitcher-strikeouts analytic sharpening — a separate, parallel task on the
  mlb-v1.2 engine (the owner's "other props as sharp or sharper" question),
  not part of patterns.
- Folding any pattern frequency into the projection.
- Non-batter and non-listed markets.
- The EV>99 cold-but-rising-quality overlay (owner deferred it).
