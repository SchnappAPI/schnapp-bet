# ADR-20260517-3 — Doc and commit policy: atomic logical commits, one-liner CHANGELOG, no per-directory CLAUDE.md pointers

Date: 2026-05-17
Status: Accepted
Supersedes: portions of the original scaffolding rules in CLAUDE.md — specifically, "one commit per file" and the multi-sentence CHANGELOG format.

## Context

Several conventions accumulated during scaffolding that did not pay for themselves at the current scale:

1. **One commit per file** produced 55 commits for the scaffolding milestone alone. Coupled changes (function signature + its callers, code + its CHANGELOG entry, ADR + first application) split across commits produce intermediate states that do not compile and cannot be bisected. The `git log` narrative becomes noise.

2. **Multi-sentence CHANGELOG entries** drifted toward paragraph-form release notes and frequently restated ADRs in narrative. Two write surfaces, same content.

3. **Per-directory CLAUDE.md pointer files** (`database/CLAUDE.md`, `services/flask/CLAUDE.md`) reduced to thin "see `.claude/rules/<name>.md`" indirection once path-scoped rules were auto-loading. Every reader now takes an extra hop for no information gain.

4. **One-size-fits-all session lifecycle ceremony** (read MEMORY → work → update MEMORY → CHANGELOG → ADR → maybe LEARNED) was overkill for trivial fixes and produced fatigue that risked skipping the same steps on real milestones.

5. **CLAUDE.md Non-Negotiables** duplicated path-specific rules that already lived in `.claude/rules/*.md` and auto-loaded in context (PYTHONPATH for workflow imports, `record_workflow_run()` last, `fast_executemany=False` for grading).

## Decision

1. **Commit unit is one logical change, not one file.** A logical change is the smallest self-consistent unit: a feature, a bugfix, a refactor. Multi-file commits are correct when files are coupled. The CHANGELOG entry for the change is part of the same commit. `git log` is the chronological source of truth.

2. **CHANGELOG entries are one-liners**, grouped under `## YYYY-MM-DD` date headers. Format: `- [scope][component] short description — ADR-YYYYMMDD-N` (ADR reference only when applicable). Long-form context lives in ADRs and commit messages, never duplicated to CHANGELOG. Existing multi-paragraph entries are reformatted in this ADR's commit.

3. **No per-directory CLAUDE.md pointer files.** Delete `database/CLAUDE.md` and `services/flask/CLAUDE.md`. Path-scoped rules under `.claude/rules/` auto-load when editing files in those directories. Per-directory `README.md` files cover human navigation and remain where they have substance (multi-subdir trees, non-obvious entry points).

4. **CLAUDE.md Non-Negotiables hold cross-cutting rules only.** Path-specific rules live in their `.claude/rules/<name>.md` file, where they auto-load on context. Rules that apply outside any specific path (e.g., "use `list_workflow_runs`, not `workflow_status`") stay in CLAUDE.md because they are not bound to a directory.

5. **Session lifecycle scales by task size:**
   - **Trivial** (typo, comment, single-line fix) — CHANGELOG entry only.
   - **Routine** (port, feature, refactor) — CHANGELOG entry + MEMORY.md state update.
   - **Milestone** (non-obvious decision, new convention, architectural shift) — CHANGELOG entry + MEMORY.md + ADR.
   - **Mid-session correction** — append to LEARNED.md immediately, regardless of size.

## Consequences

- `git log --oneline` becomes scannable history. CHANGELOG becomes a tagged filter on top of it.
- `git bisect` works reliably because each commit is self-consistent.
- Documentation surfaces collapse from {root CLAUDE.md, per-directory CLAUDE.md, per-directory README, `.claude/rules/X.md`} to {root CLAUDE.md, per-directory README where substantive, `.claude/rules/X.md`}. One fewer layer.
- CLAUDE.md shrinks: path-specific non-negotiables move to their rule files. The root file holds only cross-cutting and process rules.
- CHANGELOG diff is short; doesn't churn for every typo.
- Lower ceremony overhead on small changes; correct ceremony preserved for real decisions.
- The "never commit without a CHANGELOG entry" rule remains — but the entry rides in the same commit as the change, not a separate one.

## Out of scope

- ADR format itself (Context / Decision / Consequences / Supersedes). Unchanged.
- The bootstrap-vs-migrations hybrid (ADR-20260517-1). Separate concern.
- Auto-push system (post-commit hook + Stop hook safety net). Already in place; complements this policy.
- The `docs/` tree structure (router, runbooks, features, etc.). Will refactor as application code lands and reveals the right shape.
