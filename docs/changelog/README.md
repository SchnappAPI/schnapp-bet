# CHANGELOG

One file per year at `docs/changelog/YYYY.md`. The current year's file is the only one regularly read; prior years stay archived in place.

## Format

Each entry:

```
## YYYY-MM-DD [scope][component] short title

One or two sentences describing the change. Reference commit SHAs or file paths when useful.
```

Newest entries at the top of the file. Append-only — never rewrite a shipped entry; if context was wrong, add a follow-up entry that corrects it.

## Tag taxonomy

| Tag | Use for |
|---|---|
| `[nba]` | NBA-specific ETL, grading, web, database |
| `[mlb]` | MLB stack |
| `[nfl]` | NFL stack |
| `[shared]` | Cross-cutting code under `shared/` |
| `[etl]` | ETL pipeline changes |
| `[grading]` | Grading engine and calibration |
| `[web]` | Next.js app |
| `[database]` | Schema changes, DDL |
| `[odds]` | Odds ingestion and bookmaker logic |
| `[infra]` | Infrastructure: launchd, deploy, GitHub Actions |
| `[docs]` | Documentation updates |
| `[meta]` | Project administrative changes (this taxonomy itself, repo settings) |
| `[all]` | Multi-sport / repo-wide changes that don't fit elsewhere |

Multiple tags allowed: `[nba][grading]`, `[shared][etl][database]`, etc.

## Year rotation

Cut a new year on January 1: `/skill changelog-rotate`. If the current year's file exceeds ~50 KB and reads slow down, the same skill handles mid-year splits. Older year files are preserved; no deletions.

## Stop hook reminder

`.claude/hooks/stop-reminder.sh` nags if code changed in a session but nothing under `docs/changelog/` was touched. The hook is advisory — discipline is the user's, not the agent's.
