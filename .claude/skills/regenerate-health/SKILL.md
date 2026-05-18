---
name: regenerate-health
description: Locally regenerate docs/HEALTH.md from the live SQL Server container's data integrity tables. HEALTH.md is git-ignored; this is the on-demand way to see current health without committing potentially-broken output.
---

# Regenerate HEALTH.md

`docs/HEALTH.md` is git-ignored. The generator runs on demand and writes the result locally. Past sports-modeling committed a regenerated HEALTH.md every day from a workflow; that file occasionally contained Python errors when the script failed. The new pattern is local-only.

## When to use this skill

- Investigating an integrity check failure that surfaced in `common.ingest_quarantine`, `common.unmapped_entities`, or `common.data_completeness_log`.
- Before shipping a commit that touches the integrity framework (tag the commit `[shared][grading]`).
- During on-call response when something looks off in production.

## Procedure

1. Confirm the local SQL container is running. `docker ps | grep mssql`. If not, `docker start mssql` (Colima must be running first).
2. Run the generator from the repo root. The actual generator script lives in `shared/integrity.py` as `generate_health_report(engine, as_of)`. Wrap it in a one-liner:

```bash
SQL_PASS=$(grep MSSQL_SA_PASSWORD /Users/schnapp/sql-server.env | cut -d= -f2)
SQL_SERVER="localhost,1433" SQL_DATABASE="sports-modeling" \
SQL_USERNAME="sa" SQL_PASSWORD="$SQL_PASS" SQL_TRUST_CERT="yes" \
PYTHONPATH=/Users/schnapp/code/schnapp-bet \
/Users/schnapp/venv/bin/python -c "from shared.db import get_engine; from shared.integrity import generate_health_report; from datetime import date; print(generate_health_report(get_engine(), date.today()))" \
> /tmp/HEALTH.md
```

3. Review `/tmp/HEALTH.md`. If it parses cleanly, copy to `docs/HEALTH.md`:

```bash
cp /tmp/HEALTH.md docs/HEALTH.md
```

4. Read it. Do not commit — `docs/HEALTH.md` is in `.gitignore`.

## Anti-patterns

- Committing HEALTH.md to git. The git history of broken health reports is what we are escaping from.
- Running the generator from a workflow on a schedule. The whole point of D5 is to make health a pull-when-you-need-it artifact.
- Reading `docs/HEALTH.md` and trusting its as_of date without checking — the file lives only locally and may be hours or days old.
