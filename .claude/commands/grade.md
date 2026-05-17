---
name: grade
description: Trigger the grading workflow. Asks for sport and mode, then dispatches
  and monitors the run.
---

Ask: "Sport (nba/mlb) and mode (upcoming/intraday/backfill/outcomes)?"

Then:
1. Dispatch `grading.yml` (NBA) or `mlb-grading.yml` (MLB) via `workflow_trigger` with the chosen mode as input.
2. Poll `list_workflow_runs` for that workflow until status is `completed`.
3. If `failure`, fetch and show the last 50 lines of the run log.
4. If `success`, report: run ID, duration, and row counts if visible in the log (lines written to daily_grades, tier_lines).
5. For NBA upcoming/intraday: confirm `record_workflow_run` was called by checking the log for "workflow_runs updated".
