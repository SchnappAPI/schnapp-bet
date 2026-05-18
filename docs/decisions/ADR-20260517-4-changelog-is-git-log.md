# ADR-20260517-4 — Commit log is the changelog: drop docs/changelog/

Date: 2026-05-17
Status: Accepted
Supersedes: portions of ADR-20260517-3 — specifically the one-liner CHANGELOG format and the requirement that every commit carry a separate CHANGELOG entry. The other parts of ADR-20260517-3 (atomic logical commits, no per-directory CLAUDE.md pointers, session lifecycle scaled by task size) remain in force.

## Context

ADR-20260517-3 reduced CHANGELOG entries to one-liners and put them in the same commit as the change. That eliminated paragraph duplication with ADRs but left a duplicate-by-design write surface: every change is described twice, once in the commit subject and once in `docs/changelog/YYYY.md`.

When the one-liner format is well-disciplined, the CHANGELOG line and the commit subject convey identical information. Maintaining both creates:

- Two places that can drift out of sync.
- An extra file edit per commit.
- A "did I update the CHANGELOG?" cognitive overhead the auto-push system was supposed to retire.
- A skill (`changelog-rotate`) and supporting README whose only purpose is to manage the file.

Git history already serves as a chronological record. With well-formatted commit subjects, `git log` is greppable, filterable by tag, exportable to a rendered file on demand. No additional tool is required — `git log --pretty` covers it.

## Decision

1. **`git log` is the changelog.** Delete `docs/changelog/2026.md`, `docs/changelog/README.md`, the `docs/changelog/` directory, and the `changelog-rotate` skill. Year rotation becomes `git log --since=YYYY-01-01`.

2. **Commit subject format becomes the changelog entry format.** Required structure:

   ```
   <type>: [scope1][scope2] short description — ADR-YYYYMMDD-N
   ```

   - `<type>` ∈ {`feat`, `fix`, `refactor`, `docs`, `chore`, `perf`, `test`, `style`, `revert`}. Keeps conventional-commit compatibility for any future tooling.
   - `[scope]` brackets carry the rich tag taxonomy: `[nba]`, `[mlb]`, `[nfl]`, `[shared]`, `[etl]`, `[grading]`, `[web]`, `[database]`, `[odds]`, `[services]`, `[infra]`, `[docs]`, `[meta]`, `[all]`. Multiple tags allowed and encouraged for cross-cutting changes.
   - The ADR reference (`— ADR-YYYYMMDD-N`) is optional, included only when the change corresponds to a recorded decision.
   - Subject under ~100 characters when feasible; longer is acceptable when tags + description need it. The body can carry extended detail.

3. **Filtering and views:**

   | Need                    | Command                                         |
   | ----------------------- | ----------------------------------------------- |
   | All changes             | `git log --oneline`                             |
   | By tag                  | `git log --grep='\[nba\]'`                      |
   | By type                 | `git log --grep='^feat:'`                       |
   | Combined                | `git log --grep='^feat.*\[nba\]'`               |
   | By date                 | `git log --since=2026-01-01 --until=2026-04-01` |
   | Rendered file on demand | `git log --pretty='format:- %s' > CHANGELOG.md` |

4. **Stop hook becomes simpler.** The "code changed but no `docs/changelog/` touched" reminder goes away. The auto-push safety net stays.

5. **Session lifecycle drops the CHANGELOG step.** ADR-20260517-3's scaled ceremony now reads:
   - **Trivial** — commit with properly formatted subject.
   - **Routine** — commit + MEMORY.md state update.
   - **Milestone** — commit + MEMORY.md + ADR. The ADR's first application is referenced in the commit subject.
   - **Mid-session correction** — append to LEARNED.md immediately, regardless of size.

## Consequences

- **Single source of truth.** A change is described in exactly one place: its commit subject. No drift, no duplicate writes.
- **Zero "did I update the CHANGELOG?" overhead.** The discipline becomes "write a good commit subject" — which the policy already demanded.
- **Pre-policy commit subjects** use single-scope `type(scope):` style (e.g., `refactor(meta):`). The information is preserved in `git log`, but grep patterns must allow both forms: `git log --grep='\[meta\]\|(meta)'`. Mild cost, no remediation needed.
- **`docs/changelog/` directory removed entirely.** The `changelog-rotate` skill is deleted along with it.
- **Stop hook** drops the changelog presence check; keeps auto-push safety net.
- **CLAUDE.md non-negotiable** "Never commit without a CHANGELOG entry" is rewritten as "Every commit subject IS the changelog entry — the format is mandatory."

## Out of scope

- Rewriting historical commit subjects to the new format. Destructive and rebases pushed history. Old entries stay as-is; `git log` is still searchable.
- Installing `git-cliff`. Not needed — `git log --pretty` covers rendering on demand. Revisit if versioned release notes become a real need.
- `.claude/rules/docs.md` rules for ADR/README/runbook formats. Unchanged.
