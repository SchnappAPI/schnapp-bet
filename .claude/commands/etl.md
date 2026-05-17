---
name: etl
description: Trigger a sport-specific ETL workflow. Asks for sport, then dispatches
  and monitors the run.
disable-model-invocation: true
---

Ask: "Sport (nba/mlb/nfl) and any non-default inputs?"

Common inputs by sport:
- NBA: `days` (default 1), `skip_gate` (true/false)
- MLB: `batch` (default 50), `seasons` (default 2025)
- NFL: no inputs

Then:
1. Dispatch the correct workflow via `workflow_trigger`: `nba-game-day.yml`, `mlb-pbp-etl.yml`, or `nfl-etl.yml`.
2. Poll `list_workflow_runs` for that workflow until status is `completed`.
3. If `failure`, fetch and show the last 50 lines of the run log.
4. If `success`, report: run ID, duration, and row counts visible in the log.
