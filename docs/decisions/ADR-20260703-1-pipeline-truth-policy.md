# ADR-20260703-1: Pipeline truth policy — fail loudly, never green-but-empty

Date: 2026-07-03

## Context

A live audit found the platform's scheduled workflows green while their roots
were dead: the Odds API key was deactivated (~2026-04-24) and `odds_etl.py`
treated the 401 as a per-call `[skip]` with exit 0; `mlb-grading.yml`
"succeeded" daily in ~18s writing nothing after 2026-05-01; NBA grading
re-graded a finished June playoff slate every day, stamping fresh
`grade_date`s onto April odds; `mlb-pbp-etl.yml` was never scheduled, so
pitch-level tables froze mid-season on 2026-04-30 (two latent bugs — an
inverted ternary and a never-defined `_merge_trend_stats` — meant its
incremental trend path had never actually worked); and `common.workflow_runs`
held heartbeats for only 2 of ~20 data workflows. Fresh-dated output from
stale roots is worse than no output: it hides the outage.

## Decision

1. **Auth failures are fatal.** `odds_etl._request` raises `OddsApiAuthError`
   on HTTP 401/403 (DEACTIVATED_KEY class); the run exits non-zero with a
   pointer to `op://web-variables/ODDS_API_KEY/credential`. 404 remains a
   skip; 429/5xx remain retries.
2. **Zero work in-season is an error, not a no-op.** MLB grading exits 2 when
   games are scheduled for the grade date but no MLB props were ingested in
   the last 36h (the 36h window absorbs the UTC/ET date shift on West-coast
   slates). Off-days and offseason exit clean.
3. **Stale slates are skipped, not re-graded.** NBA `run_upcoming`/
   `run_intraday` skip when no upcoming NBA event commences on or after the
   grade date; `--force` preserves the old behavior for deliberate re-grades.
4. **Every data workflow heartbeats.** `record_workflow_run("<name>")` is a
   final step in all scheduled/dispatchable data workflows, not just the two
   NBA ones.
5. **Failures notify.** The composite action `.github/actions/notify-failure`
   opens (or comments on) one deduplicated `pipeline-failure` Issue per
   workflow on `failure()`. It is best-effort by design — a notification
   error must never mask the original failure — and requires
   `permissions: issues: write` on the calling job.

## Consequences

- With the odds key still dead, `odds-etl.yml` (and in-season grading) go red
  daily and keep one open Issue current — that is the honest state until the
  key is restored, and the intended pressure to restore it.
- Dashboards reading `common.workflow_runs` now see real per-workflow
  freshness for MLB/NFL/odds, not just NBA.
- A legitimate future case of "in-season day with zero posted props" (e.g.
  bookmaker outage) will fail the grading run; that is accepted — a human
  should look at that day anyway.
