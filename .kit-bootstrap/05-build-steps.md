# Part 05 — Build Sequence (Mac Claude Code)

Step-by-step build instructions for the Claude Code session running on Schnapps-MBP. Each step ends with a single commit. Every commit pushes automatically via the post-commit hook (to be installed in step 1).

## Preconditions

- `gh` CLI authenticated as the schnappapi-org user.
- `schnappapi/schnapp-kit` already exists (created by the chat session — Step 0 of the plan).
- Working directory: `/Users/schnapp/code/` (or wherever the user keeps repos).
- 1Password CLI available for any `op://` references later (not needed at v1 build time).

## Steps

### Step 1: Clone and scaffold

```bash
cd /Users/schnapp/code
gh repo clone schnappapi/schnapp-kit
cd schnapp-kit

# Create directory tree per Part 01.
mkdir -p \
  .claude-plugin .githooks \
  core \
  vendored \
  overlays/{agents,skills/{discover-kit-additions,audit-against-kit},commands,hooks/{git,claude},rules,contexts,overrides} \
  language-packs/{python,typescript,sql,infra}/{agents,skills,commands,hooks,rules,examples} \
  scripts \
  docs/decisions docs/bootstrap-archive \
  tests
```

Write the bootstrap file contents from Part 01:

- `.claude-plugin/plugin.json`
- `kit.config.yml`
- `CLAUDE.md`
- `README.md`
- `.gitignore`
- `vendored/.upstreams.yml`
- `docs/decisions/ADR-20260526-1-fork-ecc-and-layer.md`

Commit:

```bash
git add .
git commit -m "chore: [meta][scripts] scaffold schnapp-kit layered tree — ADR-20260526-1"
git push -u origin main
```

### Step 2: Author scripts (skeletons that pass linting; bodies in later commits)

Create each script in `scripts/` with `set -euo pipefail` and a one-line description. Make them all executable. Commit:

```bash
chmod +x scripts/*.sh
git add scripts/
git commit -m "chore: [scripts] add script skeletons (fork-ecc, sync-upstream, add-upstream, prune-languages, conflict-check, render-merged-tree, detect-languages, promote-from-project, install-as-plugin, install-user-global, enable-artifact)"
```

Then implement each script. Recommended order (commits in this order):

1. `scripts/fork-ecc.sh` — clone ECC at pinned commit, copy into `core/`, write `core/ATTRIBUTION.md`.
2. `scripts/prune-languages.sh` — apply the pruning rules from Part 02.
3. `scripts/conflict-check.sh` — walk all layers, build name → list-of-paths map, report duplicates.
4. `scripts/add-upstream.sh <name> <url> <pin>` — git subtree add, write `vendored/.upstreams.yml` entry, write `kit.config.yml` entry, run conflict-check.
5. `scripts/sync-upstream.sh <name|--all>` — bump pins, git subtree pull, re-run conflict-check.
6. `scripts/render-merged-tree.sh` — materialize the merged view into `.merged-tree/` (gitignored).
7. `scripts/install-as-plugin.sh` — local-path plugin install for testing.
8. `scripts/install-user-global.sh` — symlink merged tree into `~/.claude/`.
9. `scripts/detect-languages.sh <repo-path>` — scan and recommend packs.
10. `scripts/promote-from-project.sh <source-path> --type <kind> --name <slug>` — copy local artifact into `overlays/`, run validators.
11. `scripts/enable-artifact.sh <glob>` — toggle in `kit.config.yml`.

One commit per script. Commit subjects: `feat: [scripts] add fork-ecc.sh`, `feat: [scripts] add prune-languages.sh`, etc.

### Step 3: Fork ECC

```bash
./scripts/fork-ecc.sh
./scripts/prune-languages.sh
```

Edit `kit.config.yml` to set `core.pinned_commit` to the sha captured by `fork-ecc.sh`.

Run acceptance checks from Part 02 (file count within 15%, examples nonzero, no pruned-language frontmatter).

Commit:

```bash
git add core/ kit.config.yml
git commit -m "chore: [core][meta] fork ECC at <short-sha>, prune inapplicable languages — ADR-20260526-1"
```

### Step 4: Vendor mattpocock/skills

```bash
./scripts/add-upstream.sh mattpocock-skills https://github.com/mattpocock/skills main
./scripts/conflict-check.sh
```

If conflict-check flags any artifact-name collisions with `core/`, resolve via `disabled_artifacts` glob in `kit.config.yml` (don't delete from `vendored/`).

Commit:

```bash
git add vendored/mattpocock-skills/ vendored/.upstreams.yml kit.config.yml
git commit -m "feat: [vendored] vendor mattpocock/skills at <short-sha> with 19/20 cherry-pick"
```

### Step 5: Overlays — promote from schnapp-bet

Source of truth: Part 03 (`03-overlays-inventory.md`). For each "Promote" row, copy from `/Users/schnapp/code/schnapp-bet/<path>` to the target. For "Generalize first" rows, copy then edit as noted.

Group into logical commits (one per artifact group):

- `feat: [overlays] promote universal agents from schnapp-bet (secrets-hygiene-reviewer)`
- `feat: [overlays] promote universal skills (adr-writer, workflow, live-session-cache)`
- `feat: [overlays] promote universal commands (adr, status)`
- `feat: [overlays] promote universal hooks (git: commit-msg, post-commit; claude: destructive-guard, protect-shipped-adrs, protect-files, stop-reminder, workflow-env-validator)`
- `feat: [overlays] add rules/secrets.md (universal subset of schnapp policy)`
- `feat: [overlays] add rules/docs.md (universal)`

Then install the git hooks for the schnapp-kit repo itself so the kit dogfoods its own commit-msg and post-commit:

```bash
ln -s ../overlays/hooks/git/commit-msg .githooks/commit-msg
ln -s ../overlays/hooks/git/post-commit .githooks/post-commit
git config core.hooksPath .githooks
```

Note: the kit's commit-msg is the generalized version; if it expects a scopes file, create `.kit/commit-scopes.txt` with the schnapp-kit scopes from `CLAUDE.md`: `core, vendored, overlays, lang, scripts, docs, tests, meta, all`.

Commit:

```bash
git add .githooks/ .kit/
git commit -m "chore: [meta][overlays] dogfood overlays/hooks/git for schnapp-kit itself"
```

### Step 6: Language packs

Light v1 — most language work is already in ECC. Per Part 03:

- `language-packs/python/hooks/ruff-lint.sh` (from schnapp-bet `.claude/hooks/ruff-lint.sh`).
- `language-packs/sql/rules/database.md` (universal SQL Server 2022 / T-SQL slice of schnapp-bet `rules/database.md`).
- `language-packs/typescript/rules/web.md` (universal Next.js 15 / Tailwind slice of schnapp-bet `rules/web.md`).
- `language-packs/infra/rules/workflows.md` (universal GH Actions / 1Password slice of schnapp-bet `rules/workflows.md`).

Commit per pack:

- `feat: [lang][python] add python pack with ruff-lint hook`
- `feat: [lang][sql] add sql pack with SQL Server 2022 conventions`
- `feat: [lang][typescript] add typescript pack with Next.js 15 conventions`
- `feat: [lang][infra] add infra pack with GH Actions + 1Password conventions`

### Step 7: New skills (discover + audit)

Write `overlays/skills/discover-kit-additions/SKILL.md` and `overlays/skills/audit-against-kit/SKILL.md` per Part 04. They are prompt-only at v1.

Commit:

```bash
git add overlays/skills/discover-kit-additions overlays/skills/audit-against-kit
git commit -m "feat: [overlays] add /discover-kit-additions and /audit-against-kit kit-evolution skills"
```

### Step 8: Docs and tests

Author the docs files. Source of conventions:

- `docs/ARCHITECTURE.md` — the layer model, merge order, conflict resolution. Adapted from Part 00's "Repo Architecture" section.
- `docs/ADOPTING.md` — install steps per surface (plugin, user-global, Cowork).
- `docs/DEVELOPMENT.md` — how Claude/you evolve the kit. Cross-reference the five evolution skills.
- `docs/ADDING-A-PLUGIN.md` — the `add-upstream.sh` flow.
- `docs/ADDING-A-LANGUAGE.md` — how to add a new language pack.
- `docs/ARTIFACT-TYPES.md` — taxonomy of agents/skills/commands/hooks/rules/contexts/mcp/output-styles/statuslines/workflows.

Tests (shell scripts that exit nonzero on violation):

- `tests/validate-frontmatter.sh` — every agent/skill has required YAML frontmatter fields.
- `tests/validate-hooks.sh` — every hook script is `chmod +x` and has a shebang.
- `tests/validate-rules.sh` — every rule file is well-formed markdown with a frontmatter block.
- `tests/validate-manifests.sh` — `plugin.json` and `kit.config.yml` parse and reference existing paths.
- `tests/validate-no-orphans.sh` — every entry in `kit.config.yml.vendored.<name>.enabled_artifacts` matches at least one real file under `vendored/<name>/`.
- `tests/run-all.sh` — runs the five validators above.

Commit per file or in small groups:

- `docs: [docs] add ARCHITECTURE, ADOPTING, DEVELOPMENT`
- `docs: [docs] add ADDING-A-PLUGIN, ADDING-A-LANGUAGE, ARTIFACT-TYPES`
- `test: [tests] add validators and run-all`

### Step 9: Exercise the loop (smoke test)

```bash
# Throwaway repo to test plugin install
cd /tmp && mkdir kit-smoketest && cd kit-smoketest && git init
# Install kit as plugin
/plugin install /Users/schnapp/code/schnapp-kit

# Confirm a sampling of artifacts is visible from each layer.
# Run the new skill against an arbitrary public repo:
/discover-kit-additions https://github.com/anthropics/claude-code

# Run the audit against schnapp-bet:
/audit-against-kit /Users/schnapp/code/schnapp-bet
```

Both should produce reports matching the templates in Part 04. Capture sample outputs into `docs/examples/` for posterity.

Commit: `docs: [docs] add example discovery and audit reports`.

### Step 10: Cleanup

Follow Part 06 (`06-cleanup.md`) exactly.

## Sequencing notes for Claude Code

- **One logical change per commit** per schnapp-bet ADR-20260517-3.
- The kit's own commit-msg hook (installed in Step 5) enforces the format. Do not bypass with `--no-verify`.
- The post-commit hook auto-pushes. Network errors should retry with exponential backoff (2s, 4s, 8s, 16s) per the user's git policy.
- If at any point a step would exceed ~50% of context, pause, write a continuation note into `.kit-bootstrap/RESUME.md` in schnapp-bet, and end the session with instructions for the next Claude Code session.
