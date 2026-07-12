# ADR-20260712-4 — Conviction view on the props board (odds-free A+C locks)

Date: 2026-07-12
Status: Accepted

## Context

The odds-free props board ranked every projected hitter for each market
(~1,233 rows/slate). The owner's critique: too much noise, "I would rather
fewer, more certain picks than a bunch of picks just to have them." An expert
review surfaced the root cause — the board is a _ranker_, not a _bet-finder_:
it sorts by raw model probability, so the top is dominated by trivially-likely
outcomes (a contact hitter ~78% to get a hit), and it has no notion of edge or
conviction.

The usual conviction lever is edge vs the market line, but the owner does not
want to pay for the Odds API yet (Issue #8). So conviction must come from the
model probability itself (A) and/or the model's own settled track record (C).
A alone is insufficient: without a line, "most certain" = highest probability =
the obvious HITS plays, which is exactly the noise. C alone has nothing to rank
within. The two combine.

## Decision

Add a **Conviction view** to `/mlb/props` (default ON, "Show all" toggle to the
full pool). A pick qualifies as a lock only when:

1. **A — the model saw enough of the hitter:** `prior_games >= 30`.
2. **C — its probability band has a track record:** the pick's probability
   bucket (0.05 wide) has `>= 20` settled results over the trailing 30 days.
3. **C — that band has actually hit:** the bucket's realized hit rate is at or
   above an **absolute per-market floor** — HR 0.22, HRR 0.55, HITS 0.72.

Ranked by the realized bucket rate (the empirical conviction), not the raw model
number, which is shown only as a secondary detail. When nothing clears, the
board renders an honest "no conviction picks" rather than a forced list —
empty is a valid answer.

Absolute floors, not a lift multiple over the base rate: low-base markets clear
any reasonable lift (a 1.25x-base bar left 144 of 411 HR "qualifying"), so lift
does not express conviction there. Floors also encode "how certain" directly —
HR tops out ~26% (nothing is a lock; these are the best validated HR leans),
while HITS/HRR permit real certainty. On the 2026-07-12 slate this cut 1,233
rows to 24 HR + 1 HRR + 0 HITS. HITS showing zero is the honest result that the
model cannot currently validate high-certainty hits picks — which matches the
expert view that HITS is largely un-edgeable.

The track record is computed in the `/api/mlb-props` route from the board's own
settled grading (the same outcome definitions the board uses), so it needs no
odds feed and reuses existing data.

## Consequences

- The board defaults to a small, track-record-validated set; the full ranked
  pool is one toggle away.
- The conviction bar is a set of tunable constants (`CONVICTION_FLOOR`,
  `CONVICTION_MIN_PRIOR_GAMES`, `CONVICTION_MIN_BUCKET_N`, `TRACK_TRAIL_DAYS`).
  Higher floors = fewer, surer.
- One extra trailing-window aggregation query per board load (bounded to 30
  days, indexed). Acceptable; can be materialized if it ever drags.
- Conviction is defined by realized outcomes, so it self-corrects: if the model
  drifts, buckets stop clearing and picks drop out automatically. This ties the
  board to the transparency tab's accountability loop.
- The percentile tiers (ADR-20260712-2 lineage, prop-v1.1) remain for the
  "Show all" pool's within-market ranking; conviction supersedes them as the
  default lens.

## Out of scope

- Edge vs the market line (needs `ODDS_API_KEY`; owner deferred paying for it).
- Per-user tunable floors / a conviction slider.
- Dropping HITS entirely — the floor lets it self-exclude by data instead.
- Multi-signal conviction (park, platoon, confirmed lineup, expected PA): a
  larger modeling track the expert critique flagged, not built here.
