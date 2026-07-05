# MLB Research Dashboard — Remainder Plan

Execution plan for everything still open on `docs/features/mlb-research-dashboard.md`
(the master plan). Written 2026-07-05 to be executable step-by-step by a smaller model:
every step names its files, its verification, and the decisions that are already made.

## Context primer — established facts, do NOT re-derive

- **Shipped and live-verified:** Phases 1 (data layer), 2 (research API), 3 (research UI),
  4.5 (Gamefeed adoptions: chips/legend, HR-Park + Bat Speed columns, leader rails,
  status-keyed tabs + Matchups). Deployed; browser-passed against production twice
  (independent sessions, corroborating).
- **Phase 4 DATA layer shipped (PR #14):** `mlb.player_patterns` (backfilled ~123k rows,
  run 28726425148, wired into the nightly pbp flush loop + `--rebuild-patterns`) and
  `hit_prob`/`hr_prob` market keys in `mlb.batter_projections` (proj-v1.1, verified
  "hit_prob=350, hr_prob=350" on a full-slate grading dispatch).
- **What remains:** the Phase 4 WEB surfacing (this doc, Phase A), a bootstrap regen
  (Phase B), a pipeline spot-check (Phase C), one data-timing improvement (Phase D),
  and the Phase 5 go/no-go gate (Phase E).

### Decisions already made — do NOT re-litigate

1. Master-plan decisions D1–D5 (pre-compute grain, xBA proxy, threshold lockstep,
   no Ballpark Pal, long-format projections).
2. Pattern definitions are OURS, fixed, documented at `DDL_CREATE_PATTERNS` in
   `etl/mlb_play_by_play.py` (window 5 games, early = next 1–2, hr_hot = in-window
   AND rate >= 0.5 AND >= 3 samples; same-season; rows are through-date-INCLUSIVE).
3. **Reader rule for patterns:** always take the batter's latest `as_of_date`
   STRICTLY BEFORE the game date you are researching (mirrors `fetch_trend`).
4. `hit_prob`/`hr_prob` semantics: P(>= 1 in the game) = 1 − (1 − p_pa)^expectedPA,
   platoon factor applied to the per-PA rate, never the finished probability.
5. `web/app/api/mlb-proj/route.ts` is legacy with zero client consumers — do not
   build on it. Projections reach the UI via the research grid route's pivot
   (`web/app/api/mlb/research/grid/route.ts:485-498` → `batter.proj[market_key]`)
   and, for the player page, via the log route extension in Phase A.
6. Explicitly cut items stay cut (master plan "Explicitly cut" section).

### Environment facts (cloud sessions)

- No Mac terminal. Python/DB verification = GitHub Actions dispatches on mac-runner;
  workflows are dispatchable on a **branch ref** (`actions_run_trigger` with
  `ref: <branch>`), which is the no-push-to-main way to run modified Python.
- Mac MCP `sql_query`/`op_run`/`shell_exec` are approval-gated in unattended
  sessions; do not block on them.
- Live-site Playwright recipe: chromium `--ssl-version-max=tls1.2`,
  `proxy: {server: process.env.HTTPS_PROXY}`, import `/root/.ccr/ca-bundle.crt`
  certs into `~/.pki/nssdb`, pre-seed cookie `sb_unlock=go` for `schnapp.bet`.
  Passcode gate: live codes are in `common.user_codes`; if none is provided,
  temporarily add one via `etl/seed_user_codes.py` + `seed-user-codes.yml`
  dispatched on the work branch, then deactivate + revert (pattern proven
  2026-07-05; keep the code out of the final merged tree).
- Every commit auto-pushes; a push to main touching `web/**` fires deploy-web
  (guarded swap). Verify pushes landed (`git rev-parse HEAD origin/<branch>`).
- Before starting: check open PRs and main's recent commits for parallel-session
  work (LEARNED.md 2026-07-05).

---

## Phase A — Phase 4 web surfacing (player page + prop columns)

Goal: light up the HR pattern card and the projections row on
`/mlb/player/[playerId]`, and expose the two probability columns on the two
prop-decision surfaces that already render projections. One new branch;
UI-commit cadence rule applies (no 3+ UI commits without a browser check).

### A1 — Extend the player log route payload

File: `web/app/api/mlb/player/[playerId]/log/route.ts`.
It already returns `{..., upcoming, bvp}`; `upcoming` (lines ~236–266) carries the
next game's `gamePk`/`gameDate`/`oppPitcher*`. Add two keys to the same response
(single-payload house style — the page must not grow extra fetches):

1. `patterns`: latest `mlb.player_patterns` row for this batter with
   `as_of_date < <anchor date>` where anchor = `upcoming.gameDate` when an
   upcoming game exists, else tomorrow (so the latest row still returns
   off-season). Return
   `{asOfDate, gamesPlayed, hrGames, gamesSinceHr, patternSamples,
patternRepeats, patternHitRate, hrPatternEarly, hrPatternLate, hrHot}`.
   Null when the table has no row (rookie / no loaded games).
2. `projections`: pivot of `mlb.batter_projections` for
   `(upcoming.gamePk, batter)` → `{marketKey: {value, confidence}}`.
   Null when no upcoming game or no rows (projections are written by the
   11:30 UTC grading workflow — absent early morning is normal, render nothing).

Verification: `cd web && npx tsc --noEmit`; `curl` the route on the dev server
with a stubbed pool OR skip curl and rely on A4's browser pass (this container
has no DB — that is expected).

### A2 — HR pattern card on the player page

File: `web/app/mlb/player/[playerId]/MlbPlayerPageInner.tsx`.
Mirror the BvP strip (lines ~338–377: bordered strip, uppercase label chip,
tabular-nums spans, gated on data presence). Place it directly under the BvP
strip. Contents when `logData.patterns` exists:

- `HR HOT` accent badge when `hrHot` (reuse the chip styling idiom from
  `web/app/mlb/StatcastChips.tsx` — do not invent a third chip system).
- `Games since HR: {gamesSinceHr ?? '—'}`.
- `Repeat rate: {fmt% patternHitRate} ({patternRepeats}/{patternSamples})`.
- `Early/late: {fmt% hrPatternEarly} / {fmt% hrPatternLate}` (hide when repeats = 0).
- Subtle `as of {asOfDate}` suffix.

**Display gotcha:** pattern rates are 0–1 decimals — multiply by 100 for display.
(Opposite direction of the old `hit_probability` 0–100 gotcha; check both ways.)

### A3 — Projections row on the player page

Same file, under the pattern card. When `logData.projections` exists render one
strip: `xH`, `xTB`, `xHR` (`batter_home_runs`), `Hit% ` (`hit_prob`),
`HR%` (`hr_prob`), plus H+R+RBI (`batter_hits_runs_rbis`) — counts as
`toFixed(2)`, probabilities as percents, with the row's `confidence` shown once
(they share it). Label the strip "Projections (proj-v1.1)" — model outputs,
not market odds.

### A4 — Hit%/HR% columns on the research grid + Matchups

Files: `web/app/mlb/research/MlbResearchView.tsx` (~117–128) and
`web/app/mlb/MlbMatchupsTab.tsx` (~61–69) — both already render `xH`/`xTB` from
`b.proj["batter_hits"]`/`["batter_total_bases"]`, and the grid route already
pivots ALL market keys, so this is UI-only: add `Hit%` ← `b.proj["hit_prob"]`
and `HR%` ← `b.proj["hr_prob"]` columns (percent format, HeatCell-shaded like
the xH/xTB columns). These are the direct FanDuel HR/hits prop scan columns —
the point of the whole phase.

### A5 — Verify

1. `npx tsc --noEmit` + `npm run build` in `web/`.
2. Dev-server browser pass with stubbed API payloads (container has no DB):
   pattern card renders all states (hot / not hot / no data), projections row
   formats, grid + Matchups show the two new columns.
3. Commit per logical change (`feat: [mlb][web] ...`), open PR, CI green, owner
   merges (merge fires deploy-web automatically).
4. Post-deploy live pass (recipe above): one player page with a populated
   pattern card + projections row (pick a name from the leader rails), and
   `/mlb/research` showing Hit%/HR%. Screenshot, send to owner, update MEMORY.md.

## Phase B — bootstrap.sql regen (Mac, non-blocking)

`database/mlb/bootstrap.sql` predates `mlb.player_patterns`. On the next Mac
session run `/skill regenerate-bootstrap-sql` (generator checked in at
`database/_shared/gen_ddl.py`). Do not attempt from the cloud; nothing depends
on it until an empty-DB rebuild.

## Phase C — pipeline spot-check (5 minutes, first cloud session after 2026-07-05)

- 09:30 UTC `mlb-pbp-etl` scheduled run: log must show a
  `player_patterns: wrote N rows ... hr_hot on M rows.` line per flush.
- 11:30 UTC `mlb-grading` run: `Rows per market:` line still lists
  `hit_prob`/`hr_prob` (the run itself stays red on the odds-stale guard until
  the Odds API key returns — that is Issue #8, by design, ignore).
- If the patterns line is missing or errors: dispatch
  `mlb-pbp-etl.yml` with `rebuild_patterns: true` (idempotent) and read the log.

## Phase D — pregame projections timing (recommended next data improvement)

`compute_mlb_projections.fetch_confirmed_lineup` waits for boxscore rows, so on
game day the "confirmed" path only activates near first pitch; earlier rows fall
back to the recent-appearance pool at half confidence. ADR-20260704-1 already
flags the future step: read `mlb.daily_lineups` (the 30-min intraday poller)
as the confirmed source pregame. Implementation: in
`grading/compute_mlb_projections.py`, try `mlb.daily_lineups` for the game first,
fall back to boxscore, then to the pool; confidence full for confirmed lineups.
Verify by dispatching `mlb-grading.yml` on the branch mid-afternoon CT and
checking confidence values / row counts in the log. One commit, rides with any
Phase A PR or alone. This directly improves the prop use-case (projections and
probabilities firm up when lineups post, hours before first pitch).

## Phase E — Phase 5 gate (owner decision, do not start unbidden)

Savant Parquet loader (`mlb.statcast_pitches`, true xBA/whiff/bat-speed, keyed
game_pk + at_bat_number). Needs its own ADR when green-lit. Unlocks the
"revisit after Phase 5" list in the master plan (Pitch Velocity tab, Player
Breakdowns, Whiff% in BvP, swapping the xBA proxy). Blocked only on owner
priority, not on data.

## Roadmap tie-ins

- `docs/ROADMAP.md:16` "MLB pattern quality monitoring" — now unblocked by
  `mlb.player_patterns`; scope it after Phase A ships (compare hr_hot flags to
  realized HRs; a weekly-calibration-style report is the likely shape).
- `docs/ROADMAP.md:8` — batter projections remain "verify end-to-end once odds
  flow again"; hit_prob/hr_prob vs FanDuel lines comparison is impossible until
  the owner restores `ODDS_API_KEY` in 1Password.

## Risks / gotchas for the executor

- Percent-vs-decimal on every new display (pattern rates AND probabilities are
  0–1; per-AB `hit_probability` elsewhere is 0–100).
- Patterns reader must anchor on the UPCOMING game date, not "today" — the
  through-date-inclusive rows double-count tonight if you use `<= today` after
  the nightly load.
- Projections rows for a date exist only after that morning's 11:30 UTC grading
  run; the UI must render cleanly with `projections: null`.
- Demo mode: the log route already serves demo-pinned dates; the two new keys
  ride the same query params — no special handling, but eyeball a demo code once.
- Deploy swap: while working, treat every `web/**` push to main as scheduling a
  directory swap; keep everything committed/pushed (LEARNED.md 2026-07-04).
- Parallel sessions: check PRs/main before starting (LEARNED.md 2026-07-05).

## Open questions for the owner

1. **Phase 5 go/no-go** (Savant Parquet). Nothing else blocks on it.
2. **ODDS_API_KEY restoration** — gates the edge view (model prob vs FanDuel
   line), the ROADMAP end-to-end verification, and quiets Issue #8.
3. **"HR Hot today" leader rail?** A seventh rail on `/mlb` listing batters with
   `hr_hot = 1` whose team plays today — cheap once Phase A ships. Yes/no.
4. **Pattern-quality monitoring shape** (ROADMAP:16) — fold into
   weekly-calibration or standalone report?
