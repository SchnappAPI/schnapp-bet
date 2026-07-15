# MLB Research Dashboard — Remainder Plan (completed)

All five phases of this plan shipped by 2026-07-05 and are live:

- **Phase A** — Phase 4 web surfacing (player-page HR pattern card + projections strip,
  Hit%/HR% HeatCell columns on `/mlb/research` + Matchups) — PR #17.
- **Phase B** — `database/mlb/bootstrap.sql` regenerated (includes `mlb.player_patterns`).
- **Phase C** — nightly pipeline spot-check green (patterns rows + hit_prob/hr_prob markets).
- **Phase D** — pregame projections read `mlb.daily_lineups` confirmed lineups first — PR #18.
- **Phase E / Phase 5** — `mlb.statcast_pitches` loader via pybaseball/Savant, nightly
  incremental + backfill dispatch — PR #20, ADR-20260705-1. The owner also approved the
  "HR Hot Today" rail (PR #19).

Execution details are in the PRs, `git log`, and the master plan
[`mlb-research-dashboard.md`](./mlb-research-dashboard.md). This file stays only as the
anchor for what the plan left open:

## Still open

- **Q4 — pattern-quality monitoring shape** (referenced by `docs/ROADMAP.md`): compare
  `hr_hot` flags to realized HRs; fold into weekly-calibration or a standalone report?
  Owner decision, unanswered.
- **"Revisit after Phase 5" list** (unlocked, not started): xBA proxy swap to true
  `est_ba`, Whiff% in BvP, Pitch Velocity tab, Player Breakdowns — each a separate
  scoped follow-up.
- **ODDS_API_KEY restoration** (Issue #8) — gates the edge view and end-to-end
  verification; tracked in `docs/ROADMAP.md`.
