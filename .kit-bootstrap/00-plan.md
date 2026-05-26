# Build a Personal Claude Code Distribution (Forked from ECC)

## Self-Critique of the Prior Plan

The earlier plan made three mistakes:

1. **Wrong starting point.** It treated schnapp-bet as the seed and ECC as a reference. The right move is the inverse: **fork ECC as the foundation**, prune only what's truly inapplicable, then layer schnapp-bet's universal pieces on top. ECC has 75 agents, 246 skills, 95 commands — most of which I was implicitly discarding by starting from a 2/6/5 base. That's throwing away years of curation.

2. **No mechanism for external plugins.** You explicitly want to incorporate `caveman`, `grill-me`, `grill-my-docs`, and "any others that may be useful." My plan had no system for this — it assumed all artifacts originate from you or from schnapp-bet. A real personal distribution needs to be a **meta-distribution / aggregator**: it vendors upstream plugins (with version pinning), lets you cherry-pick which of their artifacts to expose, and detects conflicts.

3. **Confused "minimal" with "scalable."** I framed it as "extract only universal pieces." You said scalable. Scalable means: ship the long tail by default (every example, every reference impl, every variant), make activation opt-in per project, and let the kit absorb new patterns without restructuring. ECC's "kitchen sink with auto-discovery" model is the scalable shape — mine was the opposite.

What I was excluding from ECC that I should not have:

- **All example/reference files** — you called this out explicitly. Keep them.
- **All language-agnostic skills and commands** — even ones I didn't see an immediate use for. Cost to keep is near-zero; cost to re-discover later is high.
- **Cross-cutting agents** (code review, refactor, doc generation, security review, perf, accessibility, etc.) regardless of which language they default to. Most are language-flexible behind a frontmatter knob.
- **Workflow templates, status-line configs, output styles, MCP server templates** — ECC ships these and they're all useful starting points.
- **The directory taxonomy itself** — ECC's conventions are battle-tested across 75/246/95 artifacts. Inherit the taxonomy; don't reinvent.

What stays excluded (safely):

- Language packs for languages you don't use (Java, Ruby, Go, Rust, PHP, C#, Kotlin, Swift, Scala, Elixir, etc.).
- Anything ECC-specific to its author's personal workflows that conflicts with yours (rare; flag at fork-time, don't auto-prune).

---

## Context

Goal: a single **personal Claude Code distribution** that

1. starts as a **fork of ECC** with non-applicable languages stripped and all example/reference files preserved,
2. **vendors third-party plugins** (`caveman`, `grill-me`, `grill-my-docs`, and any others you cherry-pick over time) under a unified roof,
3. layers **schnapp-bet's universal artifacts** on top (secrets-hygiene-reviewer, commit-msg enforcer, ADR system, etc.),
4. **distributes** to multiple surfaces (Claude Code plugin install, Claude.ai user-global symlink, Cowork),
5. **lets Claude evolve it** through a `/promote-from-project` mechanism,
6. **scales** — adding a new upstream plugin, new artifact, new language pack, or new project consumer is a small, repeatable operation.

Project rules: project-local `.claude/` wins on conflict; languages today are Python, TS/Next.js, SQL, Infra (bash/YAML/Docker/GH Actions).

---

## Repo Architecture

### Three logical layers, one tree

```
<kit-repo-root>/
├── .claude-plugin/plugin.json        # Manifest — kit is itself a plugin
├── README.md
├── CLAUDE.md                         # Conventions for working ON the kit
├── kit.config.yml                    # Master config: enabled upstreams, language packs, layer order
│
├── core/                             # LAYER 1: forked from ECC, pruned, everything else kept
│   ├── agents/
│   ├── skills/
│   ├── commands/
│   ├── hooks/
│   ├── rules/
│   ├── contexts/
│   ├── output-styles/
│   ├── statuslines/
│   ├── workflows/                    # reusable GH Actions workflow_call sources
│   ├── mcp/
│   ├── examples/                     # ECC's reference files — kept intact
│   └── ATTRIBUTION.md                # ECC source commit + license
│
├── vendored/                         # LAYER 2: third-party plugins, version-pinned
│   ├── caveman/                      # subtree or submodule of upstream
│   ├── grill-me/
│   ├── grill-my-docs/
│   ├── claude-mem/                   # if you want it under the kit umbrella
│   ├── superpowers/                  # ditto
│   └── .upstreams.yml                # source URL + pinned commit/tag for each
│
├── overlays/                         # LAYER 3: your own additions (schnapp-bet promotions + net-new)
│   ├── agents/
│   ├── skills/
│   ├── commands/
│   ├── hooks/
│   ├── rules/
│   └── overrides/                    # files that intentionally shadow core/ or vendored/
│
├── language-packs/                   # Per-language opt-in bundles
│   ├── python/{agents,skills,commands,hooks,rules,examples}
│   ├── typescript/{...}
│   ├── sql/{...}
│   └── infra/{...}
│
├── scripts/
│   ├── fork-ecc.sh                   # One-time: clone ECC, copy into core/, strip inapplicable langs
│   ├── prune-languages.sh            # Re-run after upstream sync to keep only enabled langs
│   ├── sync-upstream.sh              # Update one or all entries in vendored/
│   ├── add-upstream.sh               # Wire a new third-party plugin (caveman-style)
│   ├── enable-artifact.sh            # Toggle a single artifact on/off in kit.config.yml
│   ├── detect-languages.sh           # Scan a target repo, recommend packs + flag uncovered languages
│   ├── promote-from-project.sh       # Pull a project-local artifact into overlays/
│   ├── install-as-plugin.sh          # Local-path plugin install (for testing pre-publish)
│   ├── install-user-global.sh        # Symlink layered tree into ~/.claude/ (Claude.ai / Cowork)
│   ├── conflict-check.sh             # Lint for duplicate artifact names across layers
│   └── render-merged-tree.sh         # Materialize the final merged view (debug aid)
│
├── docs/
│   ├── ADOPTING.md
│   ├── DEVELOPMENT.md                # How Claude/you evolve the kit
│   ├── ARCHITECTURE.md               # Layer model, conflict resolution, merge order
│   ├── ADDING-A-PLUGIN.md            # Process for vendoring a new upstream
│   ├── ADDING-A-LANGUAGE.md          # Process for a new language pack
│   ├── ARTIFACT-TYPES.md
│   └── decisions/                    # ADRs for the kit itself
│
└── tests/
    ├── validate-frontmatter.sh
    ├── validate-hooks.sh
    ├── validate-rules.sh
    ├── validate-manifests.sh         # plugin.json + kit.config.yml schema
    ├── validate-no-orphans.sh        # every kit.config.yml entry exists on disk
    └── run-all.sh
```

### Layer merge order (lowest → highest priority)

`core/` (ECC fork) → `vendored/<each>/` → `language-packs/<each enabled>/` → `overlays/` → consuming project's `.claude/`.

Higher layer shadows lower by filename. `scripts/conflict-check.sh` lists every duplicated artifact across layers so a shadow is always intentional.

### `kit.config.yml` (the steering wheel)

```yaml
core:
  source: github:eccentric-modulations/ecc
  pinned_commit: <sha>
  enabled_languages: [python, typescript, sql, bash, yaml]
  pruned_languages: [java, ruby, go, rust, php, csharp, kotlin, swift, scala]
  keep_examples: true

vendored:
  mattpocock-skills:
    source: github:mattpocock/skills
    pin: main@<sha>
    # see "mattpocock/skills cherry-pick" section for enable/disable rationale
    enabled_artifacts:
      - skills/engineering/diagnose/**
      - skills/engineering/grill-with-docs/**
      - skills/engineering/improve-codebase-architecture/**
      - skills/engineering/prototype/**
      - skills/engineering/setup-matt-pocock-skills/**
      - skills/engineering/tdd/**
      - skills/engineering/to-issues/**
      - skills/engineering/to-prd/**
      - skills/engineering/triage/**
      - skills/engineering/zoom-out/**
      - skills/productivity/caveman/**
      - skills/productivity/grill-me/**
      - skills/productivity/handoff/**
      - skills/productivity/write-a-skill/**
      - skills/misc/git-guardrails-claude-code/** # eval vs schnapp's destructive-guard at adoption
      - skills/misc/scaffold-exercises/**
      - skills/misc/setup-pre-commit/** # eval vs schnapp's commit-msg/post-commit
      - skills/personal/edit-article/**
    disabled_artifacts:
      - skills/deprecated/**
      - skills/in-progress/**
      - skills/misc/migrate-to-shoehorn/** # only if you adopt @total-typescript/shoehorn
      - skills/personal/obsidian-vault/** # only if you use Obsidian
  # NOTE: JuliusBrussee/caveman intentionally NOT vendored — mattpocock-skills
  # ships caveman at skills/productivity/caveman. If the two diverge later, prefer
  # whichever is more actively maintained and pin the other or drop it.

language_packs_enabled: [python, typescript, sql, infra]

overlays_priority: highest
```

This file IS the cherry-pick UI. Toggling artifacts is a one-line edit + `scripts/conflict-check.sh`.

---

## What Gets Forked From ECC (Concrete Plan)

Phase 0, single operation, scripted in `scripts/fork-ecc.sh`:

1. Clone ECC at a pinned commit.
2. Copy the entire tree into `core/`.
3. Run `scripts/prune-languages.sh` — removes language-specific dirs/files for the pruned-language list in `kit.config.yml`. Detection by:
   - directory names (`/java/`, `/ruby/`, `/go/`, etc.),
   - file extensions in `examples/` (`.java`, `.rb`, `.go`, `.rs`, `.php`, `.cs`, `.kt`, `.swift`, `.scala`),
   - frontmatter `language:` fields in agent/skill YAML.
4. Preserve everything else: ALL examples, ALL output styles, ALL statuslines, ALL workflows, ALL mcp templates, ALL cross-cutting agents/skills/commands.
5. Write `core/ATTRIBUTION.md` recording ECC source repo + commit + license.
6. Commit: `chore: [meta][core] fork ECC at <sha>, prune inapplicable languages`.

**Re-syncing later**: `scripts/sync-upstream.sh core` re-runs the same pipeline against a newer ECC commit. Overlays and vendored layers are untouched.

---

## Vendoring Third-Party Plugins

`scripts/add-upstream.sh <name> <github-url> <pin>` does:

1. Adds entry to `vendored/.upstreams.yml`.
2. Adds entry to `kit.config.yml` under `vendored:`.
3. Clones the plugin into `vendored/<name>/` (subtree or submodule — recommend git subtree so the files are present without submodule init friction).
4. Runs `scripts/conflict-check.sh` — surfaces any artifact name collisions with `core/` or other vendored plugins.
5. If conflicts exist, prompts you to resolve via `enabled_artifacts` / `disabled_artifacts` in `kit.config.yml`.
6. Runs tests.

Seed list for v1: `mattpocock/skills` (cherry-picking per the section below). JuliusBrussee/caveman is dropped because Matt's collection already ships `caveman`. Add more upstreams as you discover them — process is identical every time.

Cherry-picking within a vendored plugin: `kit.config.yml` supports glob patterns under each `vendored.<name>.enabled_artifacts` / `disabled_artifacts`. Default = enable everything. You can disable a specific skill without touching `vendored/<name>/` itself, keeping the upstream pristine for clean re-syncs.

---

## mattpocock/skills Cherry-Pick (Reviewed)

Reviewed the full collection. Of 20 skills across `engineering/`, `productivity/`, `misc/`, `personal/`, **19 are worth enabling** and one is contingent on tooling you don't use today. None are bad — Matt's quality bar is uniformly high. Notes per skill:

### `engineering/` — enable all 10

| Skill                           | Why enable                                                                                                              | Watchouts                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `diagnose`                      | Disciplined bug/perf loop. Universal.                                                                                   | None.                                                                                  |
| `grill-with-docs`               | Plan-vs-domain-model challenger; updates `CONTEXT.md` and ADRs inline.                                                  | Assumes `CONTEXT.md` + `docs/adr/` exist — schnapp-bet already has the ADR convention. |
| `improve-codebase-architecture` | Surfaces deepening opportunities using `CONTEXT.md` + ADRs.                                                             | Same dependency.                                                                       |
| `prototype`                     | Throwaway prototype builder (terminal-app or UI-variation modes).                                                       | None.                                                                                  |
| `setup-matt-pocock-skills`      | Scaffolds the per-repo config (issue-tracker label vocab, domain-doc layout) that the other engineering skills consume. | This is **table-stakes** for the engineering skills above to work in a new repo.       |
| `tdd`                           | Red-green-refactor vertical-slice loop.                                                                                 | None.                                                                                  |
| `to-issues`                     | Breaks a plan/PRD into vertical-slice GitHub issues.                                                                    | GitHub-dependent (you use it).                                                         |
| `to-prd`                        | Turns conversation into a PRD issue on GitHub.                                                                          | Same.                                                                                  |
| `triage`                        | Issue triage state machine.                                                                                             | Same.                                                                                  |
| `zoom-out`                      | "Step back and give broader context" prompt.                                                                            | None.                                                                                  |

### `productivity/` — enable all 4

| Skill           | Why enable                                                         | Watchouts                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caveman`       | Ultra-compressed comms mode, ~75% token reduction.                 | Use the mattpocock version; drop the JuliusBrussee fork.                                                                                                            |
| `grill-me`      | Interview-the-plan-until-every-branch-is-resolved.                 | None.                                                                                                                                                               |
| `handoff`       | Compact current conversation into a handoff doc.                   | Overlaps with `claude-mem` and `superpowers:executing-plans`. Three flavors of handoff is fine — they trigger differently. Keep all and let triggering sort it out. |
| `write-a-skill` | Skill scaffolding with progressive disclosure + bundled resources. | Overlaps with built-in `skill-creator`. Same call: keep both, different style/output.                                                                               |

### `misc/` — enable 3 of 4

| Skill                        | Decision                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git-guardrails-claude-code` | **Enable** — overlaps with schnapp's `destructive-guard.sh`. At schnapp-bet adoption time, compare the two; whichever is more comprehensive wins. Likely Matt's wins on git, schnapp's wins on `DROP TABLE` / `TRUNCATE` SQL guards — merge into one hook in `overlays/` if needed. |
| `setup-pre-commit`           | **Enable** — Husky + lint-staged + Prettier + type-check + tests. Schnapp has its own `commit-msg` enforcer; these are complementary (different stages). Useful for new repos that haven't been opinionated yet.                                                                    |
| `scaffold-exercises`         | **Enable** — cheap to keep, useful if you ever build teaching content. Disabling is a one-line edit later.                                                                                                                                                                          |
| `migrate-to-shoehorn`        | **Disable by default** — requires `@total-typescript/shoehorn`. Flip on if/when you adopt it.                                                                                                                                                                                       |

### `personal/` — enable 1 of 2

| Skill            | Decision                                                                             |
| ---------------- | ------------------------------------------------------------------------------------ |
| `edit-article`   | **Enable** — useful for docs, README work, blog posts. General-purpose prose editor. |
| `obsidian-vault` | **Disable by default** — Obsidian-specific. Flip on if you start using Obsidian.     |

### Convention dependencies Matt's engineering skills assume

The `setup-matt-pocock-skills` skill scaffolds these in any consuming repo:

- **`CONTEXT.md`** at repo root — domain language and shared vocabulary, consumed by `grill-with-docs` and `improve-codebase-architecture`.
- **`docs/adr/`** — ADR directory (schnapp-bet uses `docs/decisions/` — minor naming difference to reconcile).
- **GitHub issue triage labels** with a fixed vocabulary, consumed by `triage`, `to-issues`, `to-prd`.

For schnapp-bet adoption: run `setup-matt-pocock-skills` once, then either alias `docs/adr` → `docs/decisions` via a symlink or update the skills' configurable path. Document the decision in an ADR.

---

## Overlays: Schnapp-Bet Promotions and Net-New

Layered ON TOP of `core/` and `vendored/`. Contents at v1:

From schnapp-bet:

- `agents/secrets-hygiene-reviewer.md` (generalized)
- `hooks/commit-msg`, `hooks/post-commit`, `hooks/protect-shipped-adrs.sh`, `hooks/protect-files.sh`, `hooks/destructive-guard.sh`
- `skills/adr-writer/`, `skills/workflow/`, `skills/live-session-cache/`
- `commands/adr.md`
- `rules/secrets.md` (the universal subset of schnapp's secrets policy)

If `core/` (ECC) already ships an equivalent (e.g. ECC has an `adr-writer`), the overlay version **shadows** it. `scripts/conflict-check.sh` reports the shadow so it's intentional. You decide whether to keep your version, delete it and use ECC's, or merge the two.

Net-new in overlays (from the prior plan, still wanted):

- `contexts/dev.md`, `contexts/review.md`, `contexts/research.md` + `/mode <name>` command — unless ECC already ships an equivalent context-switching pattern, in which case use that.

---

## Language Packs

Same shape as before but smaller in scope, because most of what I had in language packs is actually already in `core/` (ECC ships Python/TS/SQL artifacts). Language packs in this kit are for **your custom, opinionated additions** on top of ECC's defaults:

- `python/` — `ruff-lint.sh`, your pyproject conventions, uv-specific rules.
- `typescript/` — Next.js 15 app-router specifics, your Tailwind/shadcn conventions.
- `sql/` — SQL Server 2022 specifics (T-SQL flavor, migration conventions).
- `infra/` — your GH Actions hygiene, 1Password `op://` URI patterns, mac-runner specifics.

Each pack has an `examples/` subdir mirroring ECC's pattern.

`scripts/detect-languages.sh` does dual duty: tells you which packs to enable for a target repo, AND warns when it sees a language none of your enabled packs covers — that's your prompt to either build a new pack or vendor an upstream one.

---

## Multi-Surface Distribution

Same as before, just plumbed through the layered tree:

- **Claude Code plugin install**: `/plugin install github:<you>/<kit-name>`. The `.claude-plugin/plugin.json` manifest tells Claude Code to auto-discover from `core/`, `vendored/*/`, the enabled `language-packs/*/`, and `overlays/` — in that order. Plugin manifest is generated from `kit.config.yml` at build time so it stays in sync.
- **Claude.ai (web)**: `scripts/install-user-global.sh` runs `scripts/render-merged-tree.sh` to materialize the post-merge view into `~/.claude/` via symlinks. Hooks aren't supported on web (documented).
- **Cowork** (and any `.claude/`-convention tool): same merged-tree symlink approach. Document the matrix.

Conflict resolution is identical across surfaces because the merge order is the same — `render-merged-tree.sh` is the single source of truth.

---

## Letting Claude Evolve the Kit

Five mechanisms — three actions and two discovery/audit skills you invoke whenever a candidate repo or your own project surfaces:

1. **`/promote-from-project`** — run inside a project repo. Identifies a local artifact, copies into `overlays/` (or proposes a new language pack), runs validators, opens a draft commit in the kit.
2. **`/vendor-plugin <github-url>`** — wrapper around `scripts/add-upstream.sh`. Lowers the friction of trying a new community plugin to seconds.
3. **`/sync-upstreams`** — bumps pins on `core/` (ECC) and all `vendored/*` entries, runs tests, surfaces breaking changes. Run weekly or on demand.
4. **`/discover-kit-additions <repo-url> [--focus <path-or-area>]`** — new skill at `overlays/skills/discover-kit-additions/`. You point it at any repo (your own, a friend's, a community plugin collection, a starred project you keep meaning to mine) and it scans for artifacts schnapp-kit doesn't yet have: agents, skills, commands, hooks, rules, status lines, output styles, MCP server configs, workflow templates, conventions worth importing. Output is a **ranked candidate list**, each entry containing:
   - artifact type and name
   - exact source path (with permalink to the pinned ref)
   - one-line description and the gap it fills in schnapp-kit
   - whether to **vendor** (third-party upstream → `vendored/`) or **promote** (your own work → `overlays/`)
   - a draft `kit.config.yml` block ready to paste
   - any anticipated conflicts with existing kit artifacts
     The `--focus` flag narrows the scan — e.g. `--focus skills/engineering` or `--focus hooks/` so you can review one area of a large repo at a time. With no flag, the agent does a full scan and self-budgets by stopping at the top N candidates per category. Composable with `/vendor-plugin` (for the third-party rows) and `/promote-from-project` (for the your-own rows).
5. **`/audit-against-kit <repo-url-or-path>`** — new skill at `overlays/skills/audit-against-kit/`. Run it against one of your project repos and it produces a **delta report** in four sections:
   - **Uncovered languages or conventions** — languages present in the repo that no enabled language pack covers; coding conventions (commit format, ADR layout, secrets handling, lint config) present in the project but not represented in the kit.
   - **Promotion candidates** — local `.claude/` artifacts that have no kit equivalent and look universal enough to belong in `overlays/`.
   - **Duplicates** — local artifacts that already exist in the kit (often slightly forked). Recommends keeping kit version, kit version with overlays-level overrides, or merging and back-promoting the better version.
   - **Conflicts** — places where the project's conventions directly contradict kit conventions. Common cases: ADR path mismatch (`docs/decisions/` vs Matt's `docs/adr/`), commit-msg format divergence, secrets-handling rules that disagree with `rules/secrets.md`, hook scripts that overlap with kit hooks. Each conflict gets a recommended fix path (project-side, kit-side, or "document the divergence as a known intentional deviation").
     Optional flags: `--write KIT-AUDIT.md` (drop the report into the audited repo) and `--open-pr` (open a draft PR to schnapp-kit with the proposed overlays/language-pack additions).

ADRs live in `docs/decisions/` with the same date-counter format you use in schnapp-bet.

---

## Adopting in schnapp-bet

After the kit is real:

1. `/plugin install github:<you>/<kit-name>`.
2. `scripts/detect-languages.sh` → confirms `[python, typescript, sql, infra]`.
3. Create `schnapp-bet/.claude/kit.local.yml` with the enabled pack names + any per-project artifact disables.
4. Delete schnapp-bet's local copies of artifacts that the kit now serves (secrets-hygiene-reviewer, the universal hooks, the universal skills, `/adr`). Keep domain-specific things (etl-integrity-reviewer, `/grade`, `/etl`, `/deploy`, the eight rules files, the three regenerate-\* skills).
5. Smoke test + adoption ADR in schnapp-bet.

---

## Status: v1 is a starting point, not the finished product

This plan describes the v1 build — the bones of the system, populated with what we know we want today. It is **intentionally not exhaustive**. The two new evolution skills (`/discover-kit-additions` and `/audit-against-kit`) exist precisely so the kit can keep absorbing new patterns indefinitely without needing a rewrite. Expect the contents of `core/`, `vendored/`, `overlays/`, and `language-packs/` to grow significantly after launch as you point the discovery and audit skills at more repos. v1 is the platform; the long tail accumulates after.

## Sequencing

0. **Create the `schnappapi/schnapp-kit` GitHub repo** (public for now) — empty, with a minimal README placeholder. This is the only step that requires my action outside the plan file in the next turn after you approve.
1. **Repo scaffold** — empty dirs, `kit.config.yml` skeleton, `plugin.json`, `CLAUDE.md`, test harness.
2. **Fork ECC** → `core/`. Prune inapplicable languages. Commit + ADR.
3. **Vendor `mattpocock/skills`** via `scripts/add-upstream.sh` with the cherry-pick list above. Resolve conflicts.
4. **Overlays from schnapp-bet** — promote in one commit per artifact group.
5. **Language packs** — python, typescript, sql, infra.
6. **Multi-surface install scripts** + `render-merged-tree.sh`.
7. **Evolution scripts and skills** — `promote-from-project.sh`, `add-upstream.sh`, `sync-upstream.sh`, plus the two new skills `/discover-kit-additions` and `/audit-against-kit`.
8. **First exercise of the discovery loop**: run `/audit-against-kit schnapp-bet` and act on its delta; run `/discover-kit-additions` against one or two more candidate repos of your choosing.
9. **Adopt in schnapp-bet**, retire duplicates, write adoption ADR in schnapp-bet.

Step 3 is repeatable indefinitely — every future community plugin you discover via `/discover-kit-additions` slots in the same way.

---

## Resolved Inputs

- **Kit repo name**: `schnapp-kit` (under `schnappapi/` org).
- **ECC source**: `https://github.com/affaan-m/ECC` (public). Pin to current `main` HEAD at fork time; capture sha in `core/ATTRIBUTION.md`.
- **Upstream plugin sources**:
  - `caveman` → `https://github.com/JuliusBrussee/caveman` — vendor whole-cloth into `vendored/caveman/`.
  - **`mattpocock/skills`** → `https://github.com/mattpocock/skills` — this is a **collection** repo (Matt's personal skills, includes the "grill-me" / "grill-my-docs" family among others). Treat it as a meta-upstream: vendor into `vendored/mattpocock-skills/` but enable individual skills selectively via `kit.config.yml.vendored.mattpocock-skills.enabled_artifacts: [skills/grill-me/*, skills/grill-my-docs/*, …]`. Review the full skill list together before flipping defaults.

Add additional upstreams later via `scripts/add-upstream.sh <name> <url> <pin>` — process is identical regardless of source.

---

## Verification

- **Forked tree integrity**: post-fork, `find core -type f | wc -l` is close to ECC's file count minus pruned-language files. No skill/agent count drops more than ~15% (the pruned-language slice).
- **Examples preserved**: `find core/examples -type f` is nonzero and matches ECC's examples directory.
- **Plugin install**: `/plugin install <local-kit-path>` in a throwaway repo lists all expected artifacts (sample 5 from each layer).
- **Vendored plugin functional**: invoke a caveman / grill-me / grill-my-docs entry point in the throwaway repo and confirm it responds.
- **Conflict-check baseline**: `scripts/conflict-check.sh` reports zero unintentional conflicts (intentional shadows in `overlays/` are flagged but allowed).
- **Symlink install**: `scripts/install-user-global.sh` on a fresh user dir produces a working Claude.ai setup.
- **Detection**: `scripts/detect-languages.sh schnapp-bet/` outputs `[python, typescript, sql, infra]` with no unrecognized languages.
- **Schnapp-bet adoption**: after retiring duplicates, a normal commit still gets enforced by the kit-provided `commit-msg` hook.
- **Round-trip evolution**: `scripts/promote-from-project.sh` on a schnapp-bet local artifact lands it in `overlays/` with passing validators.
- **Upstream re-sync**: bump ECC pin by one commit, run `sync-upstream.sh core`, confirm overlays/vendored untouched and tests still pass.
- **Discovery skill end-to-end**: `/discover-kit-additions <some-third-party-repo>` returns a structured candidate list with at least one paste-ready `kit.config.yml` block; `/vendor-plugin` accepts that block and lands the upstream.
- **Audit skill end-to-end**: `/audit-against-kit schnapp-bet` produces a four-section delta report; at least the "Conflicts" section flags the `docs/decisions` vs `docs/adr` naming difference inherited from Matt's engineering skills.
