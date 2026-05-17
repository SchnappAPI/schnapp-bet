# MEMORY.md

## Current Focus
Repo freshly created. No code yet. First task: establish docs skeleton and component CLAUDE.md
files so sessions have something to read at start.

## Active Items
- Repo created at SchnappAPI/schnapp-bet (2026-05-17). Empty except for root files.
- Component CLAUDE.md files committed for etl/, grading/, web/, shared/, services/flask/, database/.
- No workflows, no Python, no Next.js app yet.

## Next Up
- Port ETL scripts from sports-modeling (starting with shared/db.py and shared/integrity.py).
- Port grading engine (grade_props.py, mlb_grade_props.py).
- Scaffold Next.js app under web/.

## Blockers
None.

## Lessons
- push_files corrupts .py newlines and non-ASCII TSX. Use create_or_update_file for those.
- Fetch fresh SHA via get_file before every create_or_update_file on an existing file.
- fast_executemany=False on grading engine connections only, not ETL.
- PYTHONPATH=/Users/schnapp/schnapp-bet required in every workflow that imports from shared/.
- workflow_status returns stale cached data. Use list_workflow_runs for live status.
