# ADRs

Architecture Decision Records. One file per ADR. Append-only.

## Naming convention

`ADR-YYYYMMDD-N-slug.md` where:

- `YYYYMMDD` is the date the decision was made.
- `N` starts at 1 and increments for the second+ ADR on the same day.
- `slug` is kebab-case, ~3–5 words.

Find today's next counter: `ls docs/decisions/ADR-$(date +%Y%m%d)-*.md 2>/dev/null | wc -l` — that count plus 1 is the next N. The `/adr` command does this automatically.

## Format

```markdown
# ADR-YYYYMMDD-N: {title}

Date: YYYY-MM-DD

## Context

Why this came up. The problem or constraint that forced the decision.

## Decision

What was decided. Be specific — name files, columns, rules.

## Consequences

What this implies. Both intended (the benefit) and incidental (the costs).

## Supersedes (optional)

ADR-XXXXXXXX-N — one-line reason this replaces it.
```

## Editing rules

- Append-only. Never edit a shipped ADR. If the decision changes, write a new ADR that supersedes it.
- Reference legacy ADR numbers in the body when porting from an older numbering scheme. The sports-modeling repo used sequential `ADR-NNNN` for the first 19 ADRs; those have been renamed here to the date convention, with the legacy number called out in the body.
- The commit that motivates an ADR references the ADR via the `— ADR-YYYYMMDD-N` suffix on the commit subject (per ADR-20260517-4).

## Currently shipped (load-bearing)

| ADR                                                            | Topic                                                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [ADR-20260402-1](ADR-20260402-1-grading-schema-v3.md)          | Grading schema v3 (Over/Under rows, outcome_name in UNIQUE key). Legacy ADR-0005. |
| [ADR-20260420-1](ADR-20260420-1-flat-etl.md)                   | Code stays flat in `etl/`; doc subfolders additive only. Legacy ADR-0002.         |
| [ADR-20260420-2](ADR-20260420-2-mlb-preaggregated-stats.md)    | All MLB visual stats pre-aggregated. Legacy ADR-0004.                             |
| [ADR-20260420-3](ADR-20260420-3-fanduel-only.md)               | FanDuel-only bookmaker across all sports. Legacy ADR-0007.                        |
| [ADR-20260423-1](ADR-20260423-1-composite-formula-reweight.md) | Composite formula reweighted to momentum/hr60/pattern.                            |
| [ADR-20260424-2](ADR-20260424-2-data-integrity-framework.md)   | Three-layer integrity framework.                                                  |
| [ADR-20260425-2](ADR-20260425-2-db-backed-feature-flags.md)    | DB-backed feature flags as runtime visibility surface.                            |
| [ADR-20260501-3](ADR-20260501-3-mlb-players-accumulate.md)     | `mlb.players` accumulates across seasons; NFL `get_engine` consolidation.         |
| [ADR-20260505-1](ADR-20260505-1-player-value-lines.md)         | Replace KDE tier lines with EV%-based `player_value_lines` (NBA only).            |
| [ADR-20260506-1](ADR-20260506-1-bloomberg-linear-redesign.md)  | Bloomberg × Linear redesign.                                                      |
| [ADR-20260517-1](ADR-20260517-1-bootstrap-strategy.md)         | Hybrid bootstrap strategy: regenerate sport schemas, migrate `common.*`.          |
| [ADR-20260517-2](ADR-20260517-2-scaffolding-milestone.md)      | schnapp-bet structure-and-scaffolding milestone disposition.                      |
| [ADR-20260517-3](ADR-20260517-3-doc-commit-policy.md)          | Atomic logical commits; session ceremony scaled by task size.                     |
| [ADR-20260517-4](ADR-20260517-4-changelog-is-git-log.md)       | Commit log is the changelog; mandatory subject format.                            |
| [ADR-20260517-5](ADR-20260517-5-secrets-from-1password.md)     | 1Password is the single source of truth for runtime secrets.                      |
| [ADR-20260524-1](ADR-20260524-1-mechanize-non-negotiables.md)  | CLAUDE.md non-negotiables mechanized as PreToolUse Bash hook.                     |
| [ADR-20260617-1](ADR-20260617-1-fail-closed-secrets.md)        | Fail closed on missing security secrets in production.                            |

Known gap: `ADR-20260425-3` is cited by `weekly-calibration.yml`, `grading/grade_props.py`,
`grading/weekly_calibration.py`, and `web/app/api/calibration-buckets/route.ts`, but the file
was never committed (lost in the sports-modeling port). Treat those citations as pointing at
the weekly-calibration design described in the citing code's comments.
