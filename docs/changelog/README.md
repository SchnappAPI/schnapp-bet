# CHANGELOG

One file per year at `docs/changelog/YYYY.md`. The current year's file is the only one regularly read; prior years stay archived in place.

## Format

The CHANGELOG is a tagged index over `git log`. One line per logical change, grouped under `## YYYY-MM-DD` date headers.

```
## 2026-05-17

- [scope][component] short description — ADR-YYYYMMDD-N
- [scope] another change that didn't need an ADR
```

The ADR reference is optional and used only when the entry corresponds to a recorded decision. Long-form context lives in the ADR or commit message — never duplicated into the CHANGELOG.

The CHANGELOG entry is part of the **same commit** as the change it describes (per ADR-20260517-3). Newest date header at the top; entries within a day are ordered by recency.

Append-only — never rewrite a shipped entry. If context was wrong, add a follow-up entry that corrects it.

## Tag taxonomy

| Tag          | Use for                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| `[nba]`      | NBA-specific ETL, grading, web, database                                     |
| `[mlb]`      | MLB stack                                                                    |
| `[nfl]`      | NFL stack                                                                    |
| `[shared]`   | Cross-cutting code under `shared/`                                           |
| `[etl]`      | ETL pipeline changes                                                         |
| `[grading]`  | Grading engine and calibration                                               |
| `[web]`      | Next.js app                                                                  |
| `[database]` | Schema changes, DDL                                                          |
| `[odds]`     | Odds ingestion and bookmaker logic                                           |
| `[services]` | Long-running services (Flask, MCP)                                           |
| `[infra]`    | Infrastructure: launchd, deploy, GitHub Actions, hooks                       |
| `[docs]`     | Documentation updates                                                        |
| `[meta]`     | Project administrative changes (this taxonomy itself, repo settings, policy) |
| `[all]`      | Multi-sport / repo-wide changes that don't fit elsewhere                     |

Multiple tags allowed and encouraged: `[nba][grading]`, `[shared][etl][database]`, etc.

## Year rotation

Cut a new year on January 1: `/skill changelog-rotate`. If the current year's file exceeds ~50 KB and reads slow down, the same skill handles mid-year splits. Older year files are preserved; no deletions.

## Stop hook reminder

`.claude/hooks/stop-reminder.sh` nags if code changed in a session but nothing under `docs/changelog/` was touched. The hook is advisory — discipline is the user's, not the agent's.
