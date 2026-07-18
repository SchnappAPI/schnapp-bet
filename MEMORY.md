# MEMORY.md

Current state only. History lives in `git log` (the changelog), `docs/decisions/` (ADRs), and
`LEARNED.md` (append-only corrections). When a fact here changes, overwrite it — never stack a
dated entry on top.

## Open items

- **Failover layer built, deploy blocked on owner** (ADR-20260718-1, `services/failover/`):
  snapshot push + Worker fallback committed and logic-tested; needs one interactive
  `npx wrangler login` on the Mac, then the deploy block in `services/failover/README.md`
  (bucket create, worker deploy, first push, plist load, outage simulation). The
  `CLOUDFLARE_API_TOKEN` vault item is a PLACEHOLDER (invalid token, dead R2 endpoint) —
  wrangler OAuth is the auth path, do not build on that item.
- **ODDS_API_KEY is DEACTIVATED** (Issue #8) — everything odds-dependent is dark (/mlb/grades,
  live MLB/NFL calibration corpora can't accrue, odds-stale ERROR on grading runs is expected).
  Owner must restore the key in 1Password.
- **Live board Players-to-Watch blend + cross-game time sort** (`mlb-live-hardhit` route +
  `MlbHardHitLive`, branch `claude/live-hard-hit-hr-watch-wiqxqu`): built, tsc clean, PR pending;
  live pixels + DB join need owner eyeball on the Mac.
- **Universal MLB dashboard shell** (ADR-20260712-5): merged but NOT deployed — merging `web/**`
  to main auto-fires deploy-web, so deployment is the owner's `/deploy`-gated call.
- **NFL season 2023 backfill** (run 29180855768, re-dispatched): after it lands, re-run
  `seed-calibration.yml` (idempotent) to deepen the NFL corpus. Also confirm the 2024-03→2026-07
  statcast_pitches backfill (run 28729836414) completed.
- **Pattern-quality monitoring shape** — open question to the owner
  (`docs/features/mlb-research-dashboard-remainder.md` Q4), no answer yet.
- **DB name** — 1Password `Database/database` still says `sports-modeling` (internal-only;
  rename = brief downtime, or leave indefinitely). Owner call, no urgency.

## Platform state (2026-07)

- **MLB**: research dashboard (`/mlb/research`, phases 1-4 + leaders rails + Matchups/Exit Velo
  tabs) shipped; universal filter shell (GAME/MARKET/DATE context via nested layout,
  ADR-20260712-5) across all `/mlb/*`; props board = conviction view default-on
  (ADR-20260712-4) + Situation/streaks moved to redesigned `/mlb/streaks`
  (conditional-frequency engine, ADR-20260712-3) + `/mlb/transparency`; analytic tier engine
  `mlb-v1.2` (Poisson/negbin, ADR-20260712-2); per-market gated calibrators (HR isotonic
  override live); live Statcast overlay (GUMBO feed, web-tier, 30s) on `/mlb/live` + game +
  player pages; lineups poller + `mlb.daily_lineups`; `mlb.player_patterns` +
  `player_streak_state`/`player_streak_dist`; `mlb.statcast_pitches` nightly loader.
- **NFL**: `nfl-v1.0` grading (8 FanDuel markets, daily 13:00 UTC, clean offseason exit);
  Platt calibrator live; foundation ADR-20260703-2.
- **NBA**: in-season Sunday runs judge the incumbent calibrator weekly; stale-slate re-grading
  fixed; live overlay architecture is the model MLB's was copied from.
- **Calibration v2** (ADR-20260712-1): one gated calibrator per sport in
  `common.grade_calibration` (+ per-market overrides), publish only on holdout win;
  weekly Brier/logloss/ECE history in `grade_calibration_history`.
- **Brand**: Schnappy mascot v2 (28 SVGs from `web/scripts/generate_mascot.py`, character sheet
  at `/mascot/index.html`; edit the generator, never the SVGs).
- **grading-v2/ removed 2026-07-15** (was shelved; stale scratch tree — history in git).

## Live agents on Schnapps-MBP

- `bet.schnapp.flask` — Flask runner, port 5000, via `services/launchd/op-wrap.sh`.
- `bet.schnapp.web-prod` — Next.js prod, port 3001, served from `web/.next/`, via op-wrap.
- `actions.runner.SchnappAPI-schnapp-bet.mac-runner-1` — self-hosted GH Actions runner.

## Operational gotchas (durable; details in LEARNED.md and the ADRs)

- deploy-web swaps the live repo dir and ABORTS on a dirty tree or unpushed commits — commit +
  push (including MEMORY.md) before expecting a deploy to pass; re-check `core.hooksPath` after
  any swap.
- Verify every push landed (`git rev-parse HEAD origin/main`) — the auto-push hook is not
  trustworthy after a deploy.
- Streak-state MERGE upserts but never DELETEs: a fix that changes which (batter,date) rows
  qualify requires clearing both streak tables before a corrective rebuild.
- Changing the analytic tier engine or `ANALYTIC_TIER_MODELS` config REQUIRES clear + reseed of
  the mlb calibration corpus (rule in `.claude/rules/grading.md`).
- Cloud containers: no DB, PasscodeGate blocks raw curl (dev BYPASS const; `sb_unlock` cookie is
  only the middleware bypass); worktrees have no node_modules (symlink from the main checkout);
  Playwright needs `--ssl-version-max=tls1.2` + proxy CA in `~/.pki/nssdb`.
- Conventions (commit format, secrets, hooks, session ceremony) live in CLAUDE.md and
  `docs/decisions/` — not restated here.
