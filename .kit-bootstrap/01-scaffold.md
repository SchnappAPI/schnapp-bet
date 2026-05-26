# Part 01 — Repo Scaffold

Exact directory layout and the **content** of every file the Mac session needs to create up front (before forking ECC or vendoring upstreams).

## Directory tree to create

```
schnapp-kit/
├── .claude-plugin/
│   └── plugin.json
├── .githooks/
│   └── (intentionally empty at v1; commit-msg / post-commit are in overlays/hooks/)
├── core/                          # ECC fork lands here in step 2
├── vendored/
│   └── .upstreams.yml             # initial empty registry
├── overlays/
│   ├── agents/
│   ├── skills/
│   │   ├── discover-kit-additions/
│   │   └── audit-against-kit/
│   ├── commands/
│   ├── hooks/
│   ├── rules/
│   ├── contexts/
│   └── overrides/
├── language-packs/
│   ├── python/{agents,skills,commands,hooks,rules,examples}
│   ├── typescript/{agents,skills,commands,hooks,rules,examples}
│   ├── sql/{agents,skills,commands,hooks,rules,examples}
│   └── infra/{agents,skills,commands,hooks,rules,examples}
├── scripts/
│   ├── fork-ecc.sh
│   ├── prune-languages.sh
│   ├── sync-upstream.sh
│   ├── add-upstream.sh
│   ├── enable-artifact.sh
│   ├── detect-languages.sh
│   ├── promote-from-project.sh
│   ├── install-as-plugin.sh
│   ├── install-user-global.sh
│   ├── conflict-check.sh
│   └── render-merged-tree.sh
├── docs/
│   ├── ADOPTING.md
│   ├── DEVELOPMENT.md
│   ├── ARCHITECTURE.md
│   ├── ADDING-A-PLUGIN.md
│   ├── ADDING-A-LANGUAGE.md
│   ├── ARTIFACT-TYPES.md
│   ├── bootstrap-archive/         # filled at cleanup time
│   └── decisions/
├── tests/
│   ├── validate-frontmatter.sh
│   ├── validate-hooks.sh
│   ├── validate-rules.sh
│   ├── validate-manifests.sh
│   ├── validate-no-orphans.sh
│   └── run-all.sh
├── .gitignore
├── CLAUDE.md
├── README.md
└── kit.config.yml
```

## File contents

### `.claude-plugin/plugin.json`

Plugin manifest. Auto-discovery roots are listed in `discoveryRoots` so Claude Code merges layers in the right order. Keep `version` aligned with git tags.

```json
{
  "$schema": "https://anthropic.com/schemas/claude-plugin/v1.json",
  "name": "schnapp-kit",
  "version": "0.1.0",
  "description": "Personal Claude Code distribution: ECC fork + vendored community plugins + schnapp-bet promotions. Layered, opt-in, scalable.",
  "author": {
    "name": "SchnappAPI",
    "email": "apischnapp@gmail.com",
    "url": "https://github.com/schnappapi"
  },
  "homepage": "https://github.com/schnappapi/schnapp-kit",
  "repository": {
    "type": "git",
    "url": "https://github.com/schnappapi/schnapp-kit.git"
  },
  "license": "MIT",
  "discoveryRoots": ["core", "vendored", "language-packs", "overlays"],
  "configFile": "kit.config.yml"
}
```

### `kit.config.yml` (v1 skeleton)

The chat session writes the skeleton; the Mac session fills in the `pinned_commit` values once it actually fetches ECC and mattpocock/skills.

```yaml
# kit.config.yml — the steering wheel for schnapp-kit.
# See docs/ARCHITECTURE.md for the layer model.

core:
  source: github:affaan-m/ECC
  pinned_commit: TBD_FILL_AT_FORK_TIME
  enabled_languages: [python, typescript, sql, bash, yaml]
  pruned_languages:
    [
      java,
      ruby,
      go,
      rust,
      php,
      csharp,
      kotlin,
      swift,
      scala,
      elixir,
      erlang,
      clojure,
      haskell,
      ocaml,
      fsharp,
      dart,
      lua,
      r,
      perl,
    ]
  keep_examples: true

vendored:
  mattpocock-skills:
    source: github:mattpocock/skills
    pin: main@TBD_FILL_AT_VENDOR_TIME
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
      - skills/misc/git-guardrails-claude-code/**
      - skills/misc/scaffold-exercises/**
      - skills/misc/setup-pre-commit/**
      - skills/personal/edit-article/**
    disabled_artifacts:
      - skills/deprecated/**
      - skills/in-progress/**
      - skills/misc/migrate-to-shoehorn/**
      - skills/personal/obsidian-vault/**

language_packs_enabled: [python, typescript, sql, infra]

overlays_priority: highest
```

### `CLAUDE.md` (kit-development conventions)

```markdown
# CLAUDE.md — schnapp-kit

A personal Claude Code distribution. The kit is layered: `core/` (ECC fork) → `vendored/*/` (community plugins) → `language-packs/*/` (per-language opt-ins) → `overlays/` (schnapp-bet promotions and net-new).

## Working on the kit

- **Layer respect** — never edit files inside `core/` or `vendored/<plugin>/` directly. Those are sync'd from upstream. To override, add a same-named file in `overlays/overrides/` (it shadows by filename).
- **`kit.config.yml` is the steering wheel** — toggle artifacts via glob patterns under `enabled_artifacts` / `disabled_artifacts`. After any edit, run `scripts/conflict-check.sh`.
- **Re-syncing upstreams** is one command: `scripts/sync-upstream.sh <name>` for one or `scripts/sync-upstream.sh --all`. Conflicts surface as test failures.
- **Adding a new community plugin** — `scripts/add-upstream.sh <name> <github-url> <pin>`. See `docs/ADDING-A-PLUGIN.md`.
- **Adding a new language pack** — see `docs/ADDING-A-LANGUAGE.md`.

## ADRs

`docs/decisions/ADR-YYYYMMDD-N-slug.md`. Same date-counter format as schnapp-bet.

## Commit format
```

<type>: [scope1][scope2] short description — ADR-YYYYMMDD-N

```

Scopes for this repo: `[core]`, `[vendored]`, `[overlays]`, `[lang]`, `[scripts]`, `[docs]`, `[tests]`, `[meta]`, `[all]`.

## Skills the kit ships for evolving itself

- `/discover-kit-additions <repo-url> [--focus <path>]` — scan a repo for artifacts schnapp-kit doesn't have yet.
- `/audit-against-kit <repo-url-or-path>` — scan a project repo for delta vs the kit (uncovered conventions, promotion candidates, duplicates, conflicts).
- `/promote-from-project` — move a project-local artifact into `overlays/`.
- `/vendor-plugin <url>` — wrapper around `scripts/add-upstream.sh`.
- `/sync-upstreams` — bump pins and re-test.
```

### `README.md` (top-level)

Short. Points at `docs/ADOPTING.md` for install instructions, `docs/ARCHITECTURE.md` for the layer model, and lists the seed upstreams.

```markdown
# schnapp-kit

A personal, layered Claude Code distribution. Fork of [affaan-m/ECC](https://github.com/affaan-m/ECC), with community plugins vendored on top and schnapp-bet's universal artifacts overlaid.

**Install**: `/plugin install github:schnappapi/schnapp-kit`

**Layers** (low → high priority):

1. `core/` — ECC fork, pruned to enabled languages, examples kept.
2. `vendored/` — third-party plugins, version-pinned (currently: mattpocock/skills).
3. `language-packs/` — opt-in per-language additions (python, typescript, sql, infra).
4. `overlays/` — schnapp-bet promotions and kit-native skills.

**Status**: v1 is a starting point. Use `/discover-kit-additions` and `/audit-against-kit` to grow it.

See `docs/ARCHITECTURE.md` for the layer model and `docs/ADOPTING.md` for install instructions per surface (Claude Code plugin, Claude.ai user-global, Cowork).
```

### `.gitignore`

```gitignore
# Render artifacts
.merged-tree/
*.log

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/

# Local config overrides (per-machine)
kit.local.yml

# Test outputs
tests/.tmp/
```

### `vendored/.upstreams.yml`

Initial empty registry. The Mac session fills the `mattpocock-skills` entry during the vendoring step.

```yaml
# Registry of vendored upstreams. Source of truth for sync-upstream.sh.
# Each entry pairs with a directory under vendored/<name>/.
upstreams: []
```

### `docs/decisions/ADR-20260526-1-fork-ecc-and-layer.md`

Document the layered-architecture decision as ADR-001 so the convention is established from day one.

```markdown
# ADR-20260526-1: Layered distribution — ECC core, vendored community plugins, schnapp-bet overlays

**Status**: Accepted
**Date**: 2026-05-26

## Context

A personal Claude Code distribution needs to absorb three streams of content over time: upstream community projects (ECC, mattpocock/skills, future plugins), schnapp-bet's accumulated conventions, and the user's net-new additions. The naive single-tree approach (just merge everything into one `.claude/`) makes upstream re-syncs painful and conflict resolution invisible.

## Decision

Adopt a four-layer architecture, layered lowest-to-highest priority:

1. **`core/`** — fork of ECC (https://github.com/affaan-m/ECC), pruned only of language packs we don't use (Java, Ruby, etc.). All examples and reference files kept. Re-synced from upstream via `scripts/sync-upstream.sh core`.
2. **`vendored/<name>/`** — third-party plugins, each as a git-subtree at a pinned commit. Re-synced via `scripts/sync-upstream.sh <name>`. Cherry-picking happens at the `kit.config.yml` level via `enabled_artifacts` / `disabled_artifacts` globs — never edit vendored files directly.
3. **`language-packs/<lang>/`** — opt-in, opinionated per-language additions on top of ECC's defaults.
4. **`overlays/`** — schnapp-bet promotions and net-new artifacts. Highest priority; same-named files here shadow lower layers.

The consuming project's `.claude/` directory layers on top of everything.

## Consequences

- Adding a new upstream is one repeatable command.
- Re-syncing an upstream never clobbers user changes (they live in `overlays/`).
- Conflicts are explicit and surfaced by `scripts/conflict-check.sh`.
- The cost is a slightly more complex render step (`scripts/render-merged-tree.sh`) for surfaces that don't natively understand the layer system.

## Alternatives considered

- **Flat tree, merge by hand** — Rejected. Upstream re-syncs become merge conflicts; cherry-picking becomes file deletion that has to be re-done each sync.
- **Submodules instead of subtrees** — Considered for `vendored/`. Rejected for v1: submodule init friction is high, and the upstreams we vendor are small enough that the disk-space cost of subtrees is negligible. Revisit if a vendored upstream grows past ~100 MB.
- **Start from schnapp-bet and import ECC pieces** — Rejected. Throws away ECC's 75 agents / 246 skills / 95 commands of curation.
```
