# Part 04 — Net-New Skills: `/discover-kit-additions` and `/audit-against-kit`

These two skills live in `overlays/skills/` and are the primary mechanism for the kit to keep absorbing new content over time.

## `overlays/skills/discover-kit-additions/SKILL.md`

````markdown
---
name: discover-kit-additions
description: Scan an arbitrary GitHub repo (or local path) and surface artifacts schnapp-kit doesn't yet have. Use when the user says "review this repo for kit additions", "what should I take from <repo>", "scan <url> for useful skills/agents/hooks", or `/discover-kit-additions <url>`. Supports `--focus <subpath>` to narrow the scan to one area of a large repo.
---

# discover-kit-additions

Discovery pass over a candidate repo, producing a ranked list of artifacts worth absorbing into schnapp-kit.

## When to use

- User invokes `/discover-kit-additions <repo-url>` or `/discover-kit-additions <repo-url> --focus <subpath>`.
- User asks "what should I take from <repo>", "scan <repo> for useful agents/skills/hooks/commands", "review this for kit additions".
- After cloning a starred repo you keep meaning to mine.

## Inputs

- **`<repo-url>`** (required) — GitHub URL or local path.
- **`--focus <path>`** (optional) — restrict scan to one subpath, e.g. `--focus skills/engineering`. Without it, scan all known artifact directories.

## Procedure

1. **Resolve source.** If URL, `gh repo clone` (or read via GitHub MCP if network-restricted) into a temp dir. Capture commit sha for later pinning.
2. **Enumerate kit state.** Build a set of artifact names already in schnapp-kit by walking `core/`, `vendored/*/`, `overlays/`, `language-packs/*/`. Index by canonical name (last path segment, lowercased).
3. **Enumerate candidate artifacts.** In the source repo, scan for:
   - `agents/*.md` or `**/agents/*.md`
   - `skills/**/SKILL.md`
   - `commands/*.md` or `**/commands/*.md`
   - `hooks/*` (executable scripts)
   - `rules/*.md` or `.cursor/rules/`, `.cursorrules`, `CLAUDE.md`, `AGENTS.md`
   - `.mcp.json` / `mcp-servers/`
   - `output-styles/`, `statuslines/`
   - Workflow templates: `.github/workflows/*.yml` that look reusable (workflow_call)
   - Plugin manifests: `.claude-plugin/plugin.json`
4. **Diff.** For each candidate, decide:
   - Already in kit → skip (unless `--show-duplicates` flag).
   - Net-new → candidate.
5. **Classify each candidate** with:
   - **Type** (agent / skill / command / hook / rule / mcp / workflow / output-style / statusline).
   - **Source path** (with permalink to pinned ref if URL source).
   - **One-line description** (from frontmatter `description:` or first non-frontmatter line).
   - **Gap filled** — what kit-side weakness this addresses (e.g. "no Rust pack today", "no skill for refactoring inheritance", "no agent for accessibility review").
   - **Recommendation**: `vendor` (third-party upstream → `vendored/<source-name>/`) or `promote` (your own work / public-domain pattern → `overlays/`).
   - **Draft `kit.config.yml` block** — a copy-pasteable snippet that wires the candidate in.
   - **Conflicts** — any same-name artifacts already in the kit (forces a shadow or rename decision).
6. **Rank.** Within each type, order by likely-utility (heuristic: frontmatter quality + description specificity + presence of bundled examples).
7. **Output a structured markdown report** with sections per artifact type. Each candidate is one row in a table. End the report with a "Next actions" block listing the exact `/vendor-plugin` or `/promote-from-project` commands to execute the recommendations.

## Output format

````markdown
# Discovery report — <source-repo> @ <sha>

Scope: <full|--focus subpath>
Candidates: <N>
Recommendation summary: <X to vendor, Y to promote, Z conflicts>

## Skills (M candidates)

| Name | Path | Description | Gap filled | Action | Conflicts |
| ---- | ---- | ----------- | ---------- | ------ | --------- |
| ...  |      |             |            |        |           |

## Agents (M candidates)

...

## Hooks (M candidates)

...

## Next actions

```bash
# Vendor the whole upstream:
/vendor-plugin <source-repo-url> --pin <sha>

# Enable specific cherry-picks:
# (paste into kit.config.yml under vendored.<name>.enabled_artifacts)
- skills/foo/**
- agents/bar.md

# OR, for individual promotions:
/promote-from-project <source-path> --type skill --name foo
```
````
````

```

## Failure modes to handle

- Source repo too large to scan in one pass → recommend `--focus <path>` and exit.
- No `.claude-plugin/plugin.json` and no recognizable artifact directories → emit "no artifacts detected; this repo is probably not a Claude Code distribution" and exit.
- Network unreachable for clone → ask the user for the relevant subpaths and proceed manually.

## Composes with

- `/vendor-plugin <url>` — executes vendor recommendations.
- `/promote-from-project <path>` — executes promote recommendations.
- `/audit-against-kit <repo>` — the inverse direction (does the kit cover this repo).
```

## `overlays/skills/audit-against-kit/SKILL.md`

````markdown
---
name: audit-against-kit
description: Scan one of the user's project repos and produce a delta report vs schnapp-kit. Use when the user says "audit <repo> against the kit", "what does the kit miss for <repo>", "where does <repo> conflict with the kit", or `/audit-against-kit <repo>`. Four-section output: uncovered conventions, promotion candidates, duplicates, conflicts.
---

# audit-against-kit

Reverse-direction pass: given a project repo, surface where schnapp-kit doesn't meet its needs and where its conventions conflict with the kit's.

## When to use

- User invokes `/audit-against-kit <repo-url-or-path>`.
- User asks "audit my repo against the kit", "what's the kit missing for X", "what does X disagree with the kit on".
- Before adopting the kit in a project, to know what reconciliation work is ahead.
- Periodically on the user's main repos to catch drift.

## Inputs

- **`<repo-url-or-path>`** (required) — GitHub URL or local path.
- **`--write KIT-AUDIT.md`** (optional) — drop the report into the audited repo's root.
- **`--open-pr`** (optional) — open a draft PR to schnapp-kit with the proposed overlays/language-pack additions.

## Procedure

1. **Resolve source.** Same as `discover-kit-additions`.
2. **Build kit catalog** (same indexing as `discover-kit-additions`).
3. **Detect repo's tech profile.**
   - Languages present (by file extension, manifests like `package.json`, `pyproject.toml`, `Cargo.toml`, `*.csproj`, etc.).
   - Conventions present:
     - Commit-msg format (sample last 50 commits, identify pattern).
     - ADR location (`docs/decisions/`, `docs/adr/`, `architecture/decisions/`, none).
     - Secrets handling (`.env`, `.env.example`, `.env.template`, `1Password` references, `secrets.*` in workflows).
     - Hook presence (`.githooks/`, `.husky/`, `.claude/hooks/`).
4. **Compare and bucket into four sections.**

   ### Section 1: Uncovered languages or conventions
   - Languages in the repo that no enabled `language-packs/*/` covers.
   - Conventions present in the repo that the kit doesn't represent at all (e.g. repo uses a `CHANGELOG.md` format the kit has no rule for).

   ### Section 2: Promotion candidates
   - Repo-local artifacts (in `.claude/`, `.cursor/`, `agents/`, etc.) that have no kit equivalent and look universal enough to belong in `overlays/` or a language pack.
   - For each: source path + a paste-ready `/promote-from-project` command.

   ### Section 3: Duplicates
   - Repo-local artifacts that already exist in the kit. Per duplicate, recommend:
     - **Use kit version, delete local** — if local is identical or worse.
     - **Use kit version with overlay overrides** — if local has small useful customizations.
     - **Back-promote local → kit** — if local is better; suggests merging.

   ### Section 4: Conflicts
   - Direct contradictions between repo conventions and kit conventions. Common cases:
     - ADR path mismatch (e.g. repo uses `docs/decisions/`, mattpocock-skills expects `docs/adr/`).
     - Commit-msg format divergence (repo's format vs `overlays/hooks/git/commit-msg`).
     - Secrets-handling rule conflicts (repo stores plaintext envs, kit's `rules/secrets.md` forbids).
     - Hook overlap (repo has a `commit-msg` that disagrees with the kit's).
   - For each conflict, recommend one of:
     - **Project-side fix** — change the repo to match the kit. Explain the diff.
     - **Kit-side fix** — change the kit to accommodate (only when the repo convention is clearly more general). Explain.
     - **Document as intentional deviation** — write an ADR in the repo acknowledging the divergence; emit a paste-ready ADR template.

5. **Emit report** as structured markdown with the four sections, a summary header, and a "Next actions" checklist.

6. **If `--write KIT-AUDIT.md`**, drop the report into the audited repo's root (do not commit; let the user review first).

7. **If `--open-pr`**, build a branch on schnapp-kit containing the Section 2 promotions and the Section 1 language-pack stubs, push, and open a draft PR titled "audit-against-kit: deltas from <repo>".

## Output format

```markdown
# Audit report — <repo> vs schnapp-kit @ <kit-version>

Summary: <N1> uncovered, <N2> promotion candidates, <N3> duplicates, <N4> conflicts

## 1. Uncovered languages or conventions

- [language: rust] No `language-packs/rust/`. Files affected: <count>. Suggested action: scaffold pack via `scripts/add-language-pack.sh rust`.
- [convention: changelog-format] Repo uses Keep-A-Changelog format; kit has no rule. Suggested: add `overlays/rules/changelogs.md`.

## 2. Promotion candidates

| Artifact | Source path | Why universal | Promote command |
| -------- | ----------- | ------------- | --------------- |
| ...      |             |               |                 |

## 3. Duplicates

| Artifact | Local path | Kit path | Recommendation |
| -------- | ---------- | -------- | -------------- |
| ...      |            |          |                |

## 4. Conflicts

### 4.1 ADR path mismatch

- Repo: `docs/decisions/`
- Kit (via vendored mattpocock-skills): expects `docs/adr/`
- Recommended fix: project-side — `ln -s decisions docs/adr` in the repo. ADR template attached.

### 4.2 ...

## Next actions

- [ ] `scripts/add-language-pack.sh rust`
- [ ] `/promote-from-project .claude/skills/<foo> --name foo`
- [ ] In project repo: `ln -s decisions docs/adr && git add docs/adr && commit`
- [ ] Write ADR in project for intentional commit-msg deviation (template below).
```
````

## Failure modes

- Repo doesn't use Claude Code conventions at all → emit "no Claude Code artifacts detected" but still run the language and convention diff.
- Network/git failure → fall back to MCP-based read with reduced scope; document the partial-scan caveat in the report header.

## Composes with

- `/discover-kit-additions <repo>` — the inverse direction.
- `/promote-from-project <path>` — executes Section 2 actions.
- `/sync-upstreams` — periodically re-run after sync to catch new conflicts.

```

## Both skills: implementation notes

- **No code is required at v1** — these are prompt-driven skills. The agent reads the source repo and the kit, then composes the report following the templates above.
- The discovery and audit skills should be implemented as **Skill markdown files only** at v1 (no bundled Python/JS). If we later want deterministic indexing (faster diffing for huge repos), add `lib/index.py` and `scripts/build-index.sh` in a v2 ADR.
- Both skills should respect the kit's pinned commit when comparing — they describe the *current* kit state, not some abstract ideal.
```
