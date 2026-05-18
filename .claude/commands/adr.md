---
name: adr
description: Create today's ADR with the next counter under docs/decisions/. Computes the counter from existing files, prompts for title and body, and writes the file.
disable-model-invocation: true
---

Create an ADR in `docs/decisions/` using today's date and the next sequential counter.

1. Compute today's date: `date +%Y%m%d`.
2. Compute the next counter: `ls docs/decisions/ADR-$(date +%Y%m%d)-*.md 2>/dev/null | wc -l` returns N already used today; next counter is `N + 1`.
3. Ask the user for: a short slug (kebab-case, used in the filename) and a one-line title (used as the file's H1).
4. Ask the user for the body fields: `Context:` (why this came up), `Decision:` (what was decided), `Consequences:` (what this implies for future work), and optional `Supersedes:` (reference to a prior ADR being superseded).
5. Write the file to `docs/decisions/ADR-YYYYMMDD-N-slug.md` using this template:

```markdown
# ADR-YYYYMMDD-N: {title}

Date: YYYY-MM-DD

## Context

{context paragraph}

## Decision

{decision paragraph}

## Consequences

{consequences paragraph}

{optional: ## Supersedes
ADR-XXXXXXXX-N (one-line reason).}
```

6. Confirm the file was created. Report the path back to the user.

Do not commit the file as part of this command — leave that to the user's normal session-end flow. The commit subject for the change that motivated this ADR should reference the ADR with the `— ADR-YYYYMMDD-N` suffix (per ADR-20260517-4).
