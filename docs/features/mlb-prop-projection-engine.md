# MLB Batter Prop Projection Engine

**Status:** Design spec — Phase 1 pending owner review.
**Owner ask:** "Maximize/optimize everything so this is as useful a tool as possible" with "higher confidence in every number." Model-first.
**Hard constraint (owner):** **No odds.** The engine is completely unrelated to and uninfluenced by betting markets — no lines, no implied probabilities, no +EV, no odds data in any input, feature, or validation step. It is a pure outcome-projection engine, graded only against what actually happened on the field.

Derived from the HR-indicator study in this session (see the published study for the measured lifts). This doc is the build plan; a companion ADR records the modeling decisions once Phase 1 locks.

## Goal

For every batter in an upcoming slate, produce a **calibrated probability** for each prop market, from one shared model:

- **HR** — P(≥1 home run in the game)
- **Hits** — P(≥1 hit), and the full distribution for over/under lines (0.5, 1.5)
- **Total bases** — expected TB and P(≥ line)
- **H+R+RBI (HRR)** — P(≥1.5), the owner's favored market (higher base rate → easier to calibrate)

"Useful" = the numbers are trustworthy (calibrated + validated) and surfaced where bets get made (a daily board + the player page).

## Non-goals

- **No odds, ever** (owner constraint). No comparison to FanDuel or any book. If odds are ever wanted, that is a separate downstream tool that _consumes_ these projections — it never feeds them.
- Not a live win-probability model. In-game is a later phase and reuses the same projections.
- Not pitcher props (batters only, for now).

## The model — a per-PA opportunity funnel

A home run (or hit, or TB) is the end of a chain of opportunities. Model each link, then compose — this is more accurate than predicting the rare end-event directly, because each link is a denser, more stable signal.

For a batter–game:

```
expected outcomes = Σ over expected PAs of:
    P(ball in play | PA)          -- contact: 1 − K% − BB% − HBP%
  × P(quality | ball in play)     -- barrel / hard-hit propensity (the power engine)
  × P(outcome | quality, context) -- HR | barrel, hit | BIP, TB | BIP
```

Per-game probabilities aggregate across the expected PAs, e.g. `P(≥1 HR) = 1 − Π(1 − p_hr_pa)`.

Why this shape (measured this session):

- **Right denominator.** `mlb.player_at_bats` holds the full PA universe — walks (38k), IBB, HBP (5k), strikeouts (104k) are all rows, not just at-bats. Contact rate off the PA denominator is what drives hits/HRR; a per-AB model silently drops walks and expected-PA count.
- **Expected PAs** come from lineup slot (leadoff ≈ 4.6 PA vs ≈ 3.8 in the 8-hole). Sourced from `mlb.daily_lineups` (confirmed) with a role/order fallback.
- **Quality is the engine.** 76% of HRs come from the barrel window (EV ≥ 95, LA 8–32°); barrel rate is ~85% "who the hitter is," ~15% situational.

## The power estimate (the term that matters most)

`P(quality | BIP)` per batter is the highest-leverage input, so it gets the most care:

- **Exponentially-weighted (EWMA), not a hard window.** This session showed longer windows discriminate better than short ones (20-game separation 2.33× vs 3-game 1.33×) because barrels are rare and short windows are mostly noise — but a hard 10/20-game cutoff throws away stability. An EWMA (half-life ≈ 2–3 weeks) weights recent form more while keeping a long, stable memory. Resolves the "why 10 games" question: it's neither 5 nor 20, it's a decayed rate.
- **Partial pooling (empirical-Bayes shrinkage).** Each batter's rate is shrunk toward (a) his own multi-season baseline and (b) the league, by sample size. Thin samples (a 40-game rookie) regress hard; established hitters barely move. This is what makes per-player numbers trustworthy instead of noisy, and it automatically encodes the archetypes we found (metronome = flat form slope; form-driven = steep) via a per-batter form-sensitivity term.
- **Expected-stat features** from `mlb.statcast_pitches`: `bat_speed`, `attack_angle`, `est_slg`, `est_woba` — de-noised power signals that stabilize faster than outcomes.

## Context multipliers (knowable before first pitch)

Applied to the base per-PA rates:

- **Park** — HR factor by venue (measured spread 1.70×, STL → LAD). From `mlb.teams` / venue.
- **Platoon** — batter `bat_side` vs opposing SP `pitch_hand`; hands already healed into `mlb.games.*_pitcher_hand`.
- **Pitcher matchup** — opposing SP HR/BIP-vulnerability and pitch-type arsenal vs the batter's pitch-type damage. Light weight (measured ~1.25× alone — real but secondary).
- **Weather** (later) — temperature / wind-out are large HR factors but not in the DB today; a Phase 3+ add once a source is wired. Flagged, not assumed.

## Targets & data sources

| Market      | Definition                       | Source columns                        |
| ----------- | -------------------------------- | ------------------------------------- |
| HR          | ≥1 `home_run`                    | `player_at_bats.result_event_type`    |
| Hits        | count of single/double/triple/HR | `player_at_bats.result_event_type`    |
| Total bases | 1/2/3/4 by hit type              | derived                               |
| HRR         | hits + runs + RBI ≥ 1.5          | hits + `result_rbi` + **runs scored** |

**HRR needs runs-scored**, which is not clean in `player_at_bats`. Source per batter-game from `mlb.batting_stats` (box-score runs). Confirm the join grain in Phase 1 (a `(game, player)` can have 2 batting rows per the known `batter_game_id` team embedding — dedupe as the research-grid loader does).

## Calibration

Raw model scores are mapped to honest probabilities with **isotonic regression** fit on a held-out split, per market. After calibration, a "15%" bucket must hit ~15%.

## Validation — how "confidence in every number" is proven (odds-free)

The deliverable of Phase 1 is not just projections — it's the **evidence they're trustworthy**, graded only against realized outcomes:

- **Out-of-time split:** train 2024–2025, test on **2026** (strictly later than any feature window — no leakage).
- **Calibration:** reliability curve + **Brier score** + log-loss per market. This is the headline "confidence" number.
- **Discrimination:** top-decile vs bottom-decile realized rate (lift), and AUC per market.
- **Beat-the-baseline:** must beat three naive predictors — league base rate, the batter's raw season rate, and the existing `mlb.batter_projections.hr_prob` (proj-v1.1). If it doesn't beat these, it isn't shipped.
- **Per-player check:** pooled estimates vs held-out per-player outcomes, to confirm shrinkage is set right.

A short generated report (calibration curves + metric table per market) is the Phase 1 artifact the owner signs off on before any UI is built.

## Storage

New table `mlb.batter_prop_projections`, one row per (batter, game_pk, as_of_date, market):

- keys: `batter_id, game_pk, game_date, market, model_version`
- probability + point estimate (`prob`, `expected`)
- funnel components for transparency on the board: `expected_pa, contact_rate, barrel_rate, park_factor, platoon_factor, matchup_factor`
- `created_at`

Written nightly (and on lineup confirmation) by a new ETL step, alongside the existing `batter_projections`. Follows CRITICAL_FIELDS / integrity conventions (`shared/integrity.py`). `model_version` string (e.g. `prop-v1`) so calibration/version changes are auditable.

## Phases

- **Phase 1 — model + validation (this build).** Feature computation, EWMA + pooled power, funnel composition, calibration, and the backtest harness + report. Python/ETL on mac-runner. Output: `mlb.batter_prop_projections` populated for a backtest range + a calibration report. **Owner reviews the report before Phase 2.**
- **Phase 2 — daily prop board** (`/mlb/props`): every hitter ranked by HR / HRR / hits prob, each row expandable to its funnel breakdown + context. Web only, reads the projections table. **Presentation (per owner):** lead with rank + a plain-language tier ("top-tier HR spot") and the intuitive comparison ("~3× the average hitter tonight"), with the raw probability available as a details-on-demand number rather than the headline — a bare "15%" reads as "15% of a home run," which is not how it should land. The probability is the engine's internal currency (for ranking + calibration); the surface speaks in "who's the best play, and how much better than the field."
- **Phase 3 — per-player prop profile** on the player page: archetype (metronome / form-driven / random), the funnel, today's projection.
- **Phase 4 — live in-game tie-in:** the `/mlb/live` board becomes the in-game companion; re-project remaining PAs from live state.

## Open questions for the owner

1. **Backtest range** — full 2026 season-to-date for the held-out test is the plan. OK?
2. **Markets at launch** — HR + HRR + hits + TB all in Phase 1, or start HR + HRR only and add hits/TB once those two are calibrated? (Recommend all four; they share the funnel.)
3. **HRR line** — standard is ≥1.5 (i.e., ≥2 total). Confirm that's the line you play.

## References

- HR-indicator study (this session) — measured lifts behind every choice here.
- `docs/features/mlb-research-dashboard.md` — the existing research surfaces this extends.
- `mlb.batter_projections` proj-v1.1 (`hit_prob`/`hr_prob`) — the baseline this must beat.
