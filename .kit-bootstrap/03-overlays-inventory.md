# Part 03 — Overlays Inventory (Promotions From schnapp-bet)

Maps schnapp-bet's local artifacts to where they land in schnapp-kit. Three buckets:

- **Promote** — universal, lands in `overlays/`.
- **Generalize first** — needs minor edits to strip schnapp-bet-specific paths before promoting.
- **Keep schnapp-bet-only** — domain-specific to NBA/MLB/NFL prop betting; stays put.

Source paths are relative to the schnapp-bet repo root.

## Agents

| Source                                       | Decision         | Target in schnapp-kit                         | Notes                                                                                                                                                                  |
| -------------------------------------------- | ---------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/secrets-hygiene-reviewer.md` | Generalize first | `overlays/agents/secrets-hygiene-reviewer.md` | Strip schnapp-bet-specific paths (`shared/`, `etl/`, `grading/`). Replace 1Password `op://` examples with a generic placeholder note that links to `rules/secrets.md`. |
| `.claude/agents/etl-integrity-reviewer.md`   | Keep             | (not promoted)                                | Domain-specific to NBA/MLB/NFL data integrity and ADR-20260424-2. Stays in schnapp-bet.                                                                                |

## Skills

| Source                                     | Decision         | Target in schnapp-kit                 | Notes                                                                                                                                                                         |
| ------------------------------------------ | ---------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/adr-writer/`               | Generalize first | `overlays/skills/adr-writer/`         | Default ADR path is `docs/decisions/`. Make the path configurable via skill frontmatter so projects that adopted Matt's `docs/adr/` can point at theirs. Document the option. |
| `.claude/skills/workflow/`                 | Promote          | `overlays/skills/workflow/`           | Universal task-planning skill. No schnapp-bet specifics.                                                                                                                      |
| `.claude/skills/live-session-cache/`       | Promote          | `overlays/skills/live-session-cache/` | Universal chat/\* branch capture. No schnapp-bet specifics.                                                                                                                   |
| `.claude/skills/new-sport-onboarding/`     | Keep             | (not promoted)                        | Schnapp-bet domain. Stays.                                                                                                                                                    |
| `.claude/skills/regenerate-bootstrap-sql/` | Keep             | (not promoted)                        | SQL Server 2022 + schnapp-bet schemas. Stays.                                                                                                                                 |
| `.claude/skills/regenerate-health/`        | Keep             | (not promoted)                        | Schnapp-bet integrity tables. Stays.                                                                                                                                          |

## Commands

| Source                       | Decision         | Target in schnapp-kit         | Notes                                                                                                                                                                                  |
| ---------------------------- | ---------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/commands/adr.md`    | Promote          | `overlays/commands/adr.md`    | Pairs with `overlays/skills/adr-writer/`. Same configurable-path treatment.                                                                                                            |
| `.claude/commands/status.md` | Generalize first | `overlays/commands/status.md` | Currently runs schnapp-stack health probes. Generalize into a per-repo `status` plugin point — projects supply their own `scripts/status.sh`; the command just invokes it and formats. |
| `.claude/commands/deploy.md` | Keep             | (not promoted)                | Schnapp-bet-specific workflow trigger.                                                                                                                                                 |
| `.claude/commands/etl.md`    | Keep             | (not promoted)                | Same.                                                                                                                                                                                  |
| `.claude/commands/grade.md`  | Keep             | (not promoted)                | Same.                                                                                                                                                                                  |

## Hooks

Two categories: **git hooks** (live in `.githooks/`) and **Claude Code hooks** (live in `.claude/hooks/`).

### Git hooks (`.githooks/`)

| Source                  | Decision   | Target in schnapp-kit            | Notes                                                                                                                                                                                                                                                            |
| ----------------------- | ---------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.githooks/commit-msg`  | Generalize | `overlays/hooks/git/commit-msg`  | Hardcodes the schnapp scope taxonomy (`[nba][mlb][nfl][etl]...`). Make the scope list configurable via `.kit/commit-scopes.txt` (one per line) read at hook execution. Default file ships with a permissive `feat\|fix\|...` validator and no scope restriction. |
| `.githooks/post-commit` | Promote    | `overlays/hooks/git/post-commit` | Auto-push to origin. Universal.                                                                                                                                                                                                                                  |

### Claude Code hooks (`.claude/hooks/`)

| Source                                    | Decision         | Target in schnapp-kit                             | Notes                                                                                                                                                                                                      |
| ----------------------------------------- | ---------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/hooks/destructive-guard.sh`      | Promote          | `overlays/hooks/claude/destructive-guard.sh`      | Blocks `DROP TABLE`, `TRUNCATE`, `git reset --hard`, `git push --force`, `rm -rf`, `--no-verify`. Universal. At adoption, merge with mattpocock's `git-guardrails-claude-code` — pick the union of guards. |
| `.claude/hooks/protect-shipped-adrs.sh`   | Promote          | `overlays/hooks/claude/protect-shipped-adrs.sh`   | Append-only ADR enforcement. Universal across any repo using the ADR convention.                                                                                                                           |
| `.claude/hooks/protect-files.sh`          | Promote          | `overlays/hooks/claude/protect-files.sh`          | Generic protected-file pattern. Universal.                                                                                                                                                                 |
| `.claude/hooks/ruff-lint.sh`              | Promote          | `language-packs/python/hooks/ruff-lint.sh`        | Python-pack territory, not overlays.                                                                                                                                                                       |
| `.claude/hooks/stop-reminder.sh`          | Promote          | `overlays/hooks/claude/stop-reminder.sh`          | Universal session-end reminder.                                                                                                                                                                            |
| `.claude/hooks/workflow-env-validator.sh` | Generalize first | `overlays/hooks/claude/workflow-env-validator.sh` | Required-env-vars list is schnapp-specific (`PYTHONPATH`, `SQL_*`, `ODDS_API_KEY`, `NBA_PROXY_URL`, `RUNNER_API_KEY`). Make the required list configurable via `.kit/workflow-required-envs.txt`.          |

## Rules

Eight rules files in `.claude/rules/`. Most are tightly coupled to schnapp-bet's directory layout (`etl/`, `grading/`, `shared/`, `services/flask/`, `database/`, `web/`). None promote cleanly except as **patterns** — recommend net-new rules in schnapp-kit rather than direct promotion:

| Source                         | Decision                | Target in schnapp-kit                     | Notes                                                                                                                                                                                   |
| ------------------------------ | ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/rules/etl.md`         | Keep                    | —                                         | Schnapp-bet-specific.                                                                                                                                                                   |
| `.claude/rules/grading.md`     | Keep                    | —                                         | Same.                                                                                                                                                                                   |
| `.claude/rules/shared.md`      | Keep                    | —                                         | Same.                                                                                                                                                                                   |
| `.claude/rules/flask.md`       | Keep                    | —                                         | Same.                                                                                                                                                                                   |
| `.claude/rules/database.md`    | Extract universal slice | `language-packs/sql/rules/database.md`    | Take only the SQL Server 2022 / T-SQL conventions; drop schnapp-specific schema rules.                                                                                                  |
| `.claude/rules/web.md`         | Extract universal slice | `language-packs/typescript/rules/web.md`  | Take Next.js 15 + Tailwind conventions; drop schnapp routes/components specifics.                                                                                                       |
| `.claude/rules/workflows.md`   | Extract universal slice | `language-packs/infra/rules/workflows.md` | Take GH Actions hygiene + 1Password `op://` patterns; drop schnapp workflow names.                                                                                                      |
| `.claude/rules/docs.md`        | Promote                 | `overlays/rules/docs.md`                  | Documentation conventions are universal.                                                                                                                                                |
| **Net-new** `rules/secrets.md` | Author new              | `overlays/rules/secrets.md`               | Universal subset of schnapp's secrets policy: 1Password vault is source of truth, `.env.template` lists `op://` URIs, no plaintext, GH Actions uses `1password/load-secrets-action@v2`. |

## Net-new in overlays (from plan)

- `overlays/contexts/dev.md`, `overlays/contexts/review.md`, `overlays/contexts/research.md` — context-switching profiles.
- `overlays/commands/mode.md` — `/mode <name>` to activate a context.

Skip these if `core/` (ECC) already ships a context-switching pattern; defer to ECC's. The Mac session should `grep -r 'contexts/' core/` after the ECC fork to confirm before authoring net-new files.

## Conflict-shadow expectations

`scripts/conflict-check.sh` will likely flag these as intentional overlay shadows (depending on what ECC ships):

- `overlays/skills/adr-writer/` may shadow `core/skills/adr-writer/` if ECC has one.
- `overlays/hooks/git/commit-msg` may shadow a `core/hooks/` equivalent.

Each shadow gets a one-line comment in `overlays/SHADOWS.md` explaining why we override.
