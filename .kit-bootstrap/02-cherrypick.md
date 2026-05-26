# Part 02 — Cherry-Pick Decisions

## ECC pruning (the `core/` layer)

Fork from `https://github.com/affaan-m/ECC`, pin to current `main` HEAD at fork time. Capture the exact sha in:

- `core/ATTRIBUTION.md` (recording source repo, commit, license)
- `kit.config.yml.core.pinned_commit`

After copying the tree into `core/`, run `scripts/prune-languages.sh` which removes files matching any of these patterns:

- **Directory names** at any depth: `java`, `ruby`, `go`, `rust`, `php`, `csharp`, `kotlin`, `swift`, `scala`, `elixir`, `erlang`, `clojure`, `haskell`, `ocaml`, `fsharp`, `dart`, `lua`, `r`, `perl`.
- **File extensions** in `examples/` subtrees: `.java`, `.rb`, `.go`, `.rs`, `.php`, `.cs`, `.kt`, `.swift`, `.scala`, `.exs`, `.ex`, `.erl`, `.clj`, `.hs`, `.ml`, `.fs`, `.dart`, `.lua`, `.r`, `.pl`.
- **Frontmatter `language:` field** in agent/skill YAML matching any pruned language.

**Everything else stays.** Especially: all examples, all output styles, all statuslines, all workflow templates, all MCP server templates, all cross-cutting agents and skills regardless of which language they default to. ECC's directory taxonomy is inherited as-is — do not reorganize.

Acceptance check after pruning:

- `find core -type f | wc -l` is within ~15% of ECC's total file count.
- `find core/examples -type f` is nonzero.
- No agent/skill frontmatter parses with a pruned `language:` value.

## mattpocock/skills cherry-pick (the `vendored/mattpocock-skills/` layer)

Source: `https://github.com/mattpocock/skills`. Vendor whole-cloth into `vendored/mattpocock-skills/`. Cherry-picking is purely a `kit.config.yml` concern — never delete files from the vendored tree.

Inventoried 20 skills across four categories. **Enable 19, disable 1 by default.** None are bad — the disables are tool-dependency conditional.

### `engineering/` — enable all 10

| Skill                           | Why enable                                                                             | Watchout                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `diagnose`                      | Disciplined bug / perf loop. Universal.                                                | None.                                                                                    |
| `grill-with-docs`               | Plan-vs-domain-model challenger; updates `CONTEXT.md` and ADRs inline.                 | Assumes `CONTEXT.md` and `docs/adr/` exist — schnapp-bet already has the ADR convention. |
| `improve-codebase-architecture` | Surfaces deepening opportunities using `CONTEXT.md` + ADRs.                            | Same dependency.                                                                         |
| `prototype`                     | Throwaway prototype builder (terminal-app or UI-variation modes).                      | None.                                                                                    |
| `setup-matt-pocock-skills`      | Scaffolds per-repo config (issue label vocab, domain-doc layout) for the other skills. | Run once per consuming repo. Table-stakes for the engineering skills above.              |
| `tdd`                           | Red-green-refactor vertical-slice loop.                                                | None.                                                                                    |
| `to-issues`                     | Breaks a plan/PRD into vertical-slice GitHub issues.                                   | GitHub-dependent.                                                                        |
| `to-prd`                        | Turns conversation into a PRD issue on GitHub.                                         | Same.                                                                                    |
| `triage`                        | Issue triage state machine.                                                            | Same.                                                                                    |
| `zoom-out`                      | "Step back and give broader context" prompt.                                           | None.                                                                                    |

### `productivity/` — enable all 4

| Skill           | Why enable                                                         | Watchout                                                                                                                  |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `caveman`       | Ultra-compressed comms mode, ~75% token reduction.                 | Use this version. JuliusBrussee/caveman is **not** separately vendored.                                                   |
| `grill-me`      | Interview-the-plan-until-every-branch-is-resolved.                 | None.                                                                                                                     |
| `handoff`       | Compact current conversation into a handoff doc.                   | Overlaps with `claude-mem` and `superpowers:executing-plans`. Three flavors is fine — they trigger differently. Keep all. |
| `write-a-skill` | Skill scaffolding with progressive disclosure + bundled resources. | Overlaps with built-in `skill-creator`. Keep both.                                                                        |

### `misc/` — enable 3 of 4

| Skill                        | Decision    | Notes                                                                                                                                                                                                               |
| ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git-guardrails-claude-code` | **Enable**  | Overlaps with schnapp's `destructive-guard.sh`. At schnapp-bet adoption, compare and merge into one hook in `overlays/`. Matt likely wins on git breadth; schnapp likely wins on SQL guards (DROP TABLE, TRUNCATE). |
| `setup-pre-commit`           | **Enable**  | Husky + lint-staged + Prettier + type-check + tests. Complementary to schnapp's `commit-msg` (different stages).                                                                                                    |
| `scaffold-exercises`         | **Enable**  | Cheap to keep. Useful if you ever build teaching content.                                                                                                                                                           |
| `migrate-to-shoehorn`        | **Disable** | Requires `@total-typescript/shoehorn`. Re-enable when adopted.                                                                                                                                                      |

### `personal/` — enable 1 of 2

| Skill            | Decision    | Notes                                                               |
| ---------------- | ----------- | ------------------------------------------------------------------- |
| `edit-article`   | **Enable**  | General-purpose prose editor. Useful for docs, READMEs, blog posts. |
| `obsidian-vault` | **Disable** | Obsidian-specific. Re-enable if you start using Obsidian.           |

### Convention dependency to reconcile

Matt's engineering skills assume `docs/adr/`; schnapp-bet uses `docs/decisions/`. Resolution options:

1. **Path alias** — symlink `docs/adr → docs/decisions` in the consuming repo.
2. **Skill config** — patch the skills' path constants in `overlays/overrides/` (preserves vendored tree).
3. **Adopt Matt's path** in schnapp-bet (breaking — requires renaming `docs/decisions/` to `docs/adr/` and updating all backreferences). Don't do this for v1.

Recommend option 1 (symlink) at adoption time. Document in an ADR in the consuming repo.

Matt's skills also expect `CONTEXT.md` at repo root. `setup-matt-pocock-skills` scaffolds it on first run. Not a conflict — schnapp-bet doesn't have a `CONTEXT.md` yet; introducing one is a net add.
