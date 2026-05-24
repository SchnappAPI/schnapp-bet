---
name: adr-writer
description: Author an Architecture Decision Record under docs/decisions/. Use when the current change is "milestone" tier per CLAUDE.md (non-obvious decision, new convention, architectural shift) or when the user references an ADR by number that does not yet exist. Computes the date-based counter, writes the file using the canonical template, and ensures the motivating commit subject carries the `— ADR-YYYYMMDD-N` suffix. Companion to the user-only `/adr` slash command — both produce the same on-disk format, but this skill is what Claude reaches for autonomously during session-end ceremony.
---

# adr-writer

Single source for ADR authoring in schnapp-bet. Mirrors `/adr` but is Claude-invocable so the session-end ceremony in CLAUDE.md can be honored without user prompting.

## When this fires

CLAUDE.md scales ceremony by task size. The **Milestone** tier requires `commit + MEMORY.md + ADR`. Trigger this skill at session end whenever any of these are true:

- The change introduces a **new convention** (commit format, file layout, naming policy, tag taxonomy).
- The change makes a **non-obvious tradeoff** that a future reader would otherwise re-litigate.
- The change is an **architectural shift** (new layer, removed layer, swapped dependency, security boundary).
- The user said "let's decide X" or "going forward we will Y" — the conversation itself is the ADR's `Context:`.
- The user references an ADR number (`ADR-YYYYMMDD-N`) that does not exist on disk.

Do **not** fire for: routine ports, single-file fixes, doc cleanups, mechanical renames. Those are Trivial or Routine tier.

## Procedure

### 1. Compute the filename

```bash
DATE=$(date +%Y%m%d)
N=$(( $(ls docs/decisions/ADR-${DATE}-*.md 2>/dev/null | wc -l) + 1 ))
SLUG=<kebab-case-from-decision-topic>
PATH_ADR="docs/decisions/ADR-${DATE}-${N}-${SLUG}.md"
```

The slug is short (2–5 words), describes the decision not the context. Examples from existing ADRs: `bootstrap-strategy`, `doc-commit-policy`, `changelog-is-git-log`, `secrets-from-1password`.

### 2. Write the file

ADRs are append-only — never edit a shipped one. To revise a prior decision, write a new ADR with `Supersedes:` pointing back.

Use this template verbatim. Fill the four sections; add `Supersedes:` only when applicable.

```markdown
# ADR-YYYYMMDD-N — <one-line decision title in sentence case>

Date: YYYY-MM-DD
Status: Accepted
Supersedes: ADR-XXXXXXXX-N — <one-line reason> (optional, omit if none)

## Context

<Why this came up. What problem or friction motivated the decision. Reference prior ADRs or the conversation that produced it. Two to five short paragraphs is typical — be concrete about what was costing time, money, correctness, or attention.>

## Decision

<What was decided, numbered when multiple sub-decisions hang together. Imperative voice. Include the smallest concrete change that makes the decision real (file paths, commands, config keys). If a table or code block clarifies, include it.>

## Consequences

<What this implies going forward — both costs and benefits. Include any required follow-up work, any migration cost, any rules that move into CLAUDE.md or a `.claude/rules/*.md` file.>

## Out of scope

<Optional. List things this ADR explicitly does NOT decide, so the next reader does not assume the answer.>
```

### 3. Wire into the commit subject

The commit that motivated the ADR references it: `<type>: [scope] short description — ADR-YYYYMMDD-N`. This is the only mechanical link between the change and the decision, per ADR-20260517-4. The commit-msg hook accepts the trailing reference; do not omit it.

If the ADR is being written _after_ the motivating commit has already landed, do not amend. Note the back-reference in the ADR's `Context:` instead.

### 4. Verify and report

- File written at the computed path.
- Filename matches `ADR-\d{8}-\d+-[a-z0-9-]+\.md`.
- All required sections present.
- Date in `Date:` line matches the filename date.

Report the path back. Do **not** commit — leave that to the session-end commit step, which will include MEMORY.md + the ADR in one logical change.

## Anti-patterns

- **Writing an ADR for a routine change.** Inflates the decisions directory and dilutes signal. If you cannot articulate the non-obvious tradeoff, downgrade to a MEMORY.md note.
- **Editing a shipped ADR.** Supersede with a new one. Past ADRs are historical record.
- **Bundling multiple unrelated decisions in one ADR.** Split them — each gets its own counter.
- **Omitting the `Supersedes:` line when replacing a decision.** Future readers need the chain.
- **Writing the decision into CLAUDE.md without an ADR.** CLAUDE.md is the _current_ rulebook; ADRs are _why_ those rules exist. Both are needed for milestone decisions.

## Relationship to other surfaces

| Surface                                 | Role                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `docs/decisions/ADR-YYYYMMDD-N-slug.md` | Permanent record of the _why_. Append-only.                                       |
| `CLAUDE.md` / `.claude/rules/*.md`      | The _current_ rules derived from accepted ADRs. Updated when an ADR changes them. |
| Commit subject `— ADR-YYYYMMDD-N`       | The mechanical link between code and decision.                                    |
| `MEMORY.md`                             | Cross-session working state. Not a decision log.                                  |
| `LEARNED.md`                            | Mid-session corrections. Not a decision log.                                      |
