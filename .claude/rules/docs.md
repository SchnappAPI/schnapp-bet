---
paths:
  - "docs/**"
---

- README invariant sections: edit via `str_replace` on the specific section. Never rewrite a full README.
- ADRs live one-per-file under `docs/decisions/`. Naming: `ADR-YYYYMMDD-N-slug.md`. To find today's next counter: `ls docs/decisions/ADR-$(date +%Y%m%d)-*.md`. Use the `/adr` command — it does the counter math.
- ADR body fields: `Date:`, `Context:`, `Decision:`, `Consequences:`, optional `Supersedes:`. Append-only — never edit a shipped ADR; supersede it with a new one.
- CHANGELOG: one file per year at `docs/changelog/YYYY.md`. Newest entries at the top. Format: `## YYYY-MM-DD [scope][component] short title` plus one or two sentences of detail. Tag taxonomy: `[nba]`, `[mlb]`, `[nfl]`, `[shared]`, `[web]`, `[etl]`, `[grading]`, `[infra]`, `[docs]`, `[database]`, `[odds]`, `[meta]`, `[all]`.
- Session lifecycle is documented in root `CLAUDE.md` only. Do not duplicate it in `docs/README.md` or anywhere else.
- Generated files (`HEALTH.md`) are git-ignored. Regenerate via `/skill regenerate-health` locally; do not commit.
- `docs/decisions/` and `docs/changelog/` each have their own `README.md` documenting the format. Read those before adding an entry.
- Feature specs (methodology, research, design) live under `docs/features/`. Operational runbooks (deploy, restart, recovery) live under `docs/runbooks/`. Do not conflate skills (Claude Code capabilities, under `.claude/skills/`) with feature specs.
