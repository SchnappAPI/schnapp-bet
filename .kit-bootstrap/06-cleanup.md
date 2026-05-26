# Part 06 — Cleanup Protocol

Run after the schnapp-kit v1 build is complete and pushed.

## Goal

1. Preserve the bootstrap payload in `schnapp-kit/docs/bootstrap-archive/` for posterity (anyone reading the kit later can see exactly how it was constructed).
2. Remove `.kit-bootstrap/` from `schnapp-bet` so the dir stops appearing in working-tree status and confusing future sessions.

## Steps

### 1. Archive into schnapp-kit

```bash
cd /Users/schnapp/code/schnapp-kit
mkdir -p docs/bootstrap-archive
cp -r /Users/schnapp/code/schnapp-bet/.kit-bootstrap/* docs/bootstrap-archive/

# Add an archive README explaining what these files are.
cat > docs/bootstrap-archive/README.md <<'EOF'
# Bootstrap archive — schnapp-kit v1 construction

These files were the original handoff payload used to construct schnapp-kit. They lived temporarily in `schnappapi/schnapp-bet:.kit-bootstrap/` during the multi-session bootstrap and were moved here at v1 completion.

Kept for posterity. Reading them top-to-bottom tells the story of how this repo was assembled and why every cherry-pick decision was made. They are NOT live documentation — for current docs see `docs/ARCHITECTURE.md`, `docs/ADOPTING.md`, `docs/DEVELOPMENT.md`.
EOF

git add docs/bootstrap-archive
git commit -m "docs: [docs] archive .kit-bootstrap/ from schnapp-bet for posterity"
# post-commit hook auto-pushes
```

### 2. Remove from schnapp-bet

```bash
cd /Users/schnapp/code/schnapp-bet
git checkout claude/awesome-cori-p23yR
git pull origin claude/awesome-cori-p23yR

git rm -r .kit-bootstrap
git commit -m "chore: [meta] remove .kit-bootstrap/ — schnapp-kit v1 build complete, archived in schnapp-kit/docs/bootstrap-archive/"
# post-commit hook auto-pushes
```

### 3. Verify

- `ls -la /Users/schnapp/code/schnapp-bet/.kit-bootstrap` → "No such file or directory".
- `ls -la /Users/schnapp/code/schnapp-kit/docs/bootstrap-archive` → all the part files plus the archive README.
- `git log --oneline -5` in schnapp-bet shows the removal commit at HEAD.
- `git log --oneline -5` in schnapp-kit shows the archive commit at HEAD.
- Both pushes succeeded (no failed push notifications in the post-commit hook output).

### 4. Hand back to the user

Reply with:

- The schnapp-kit repo URL.
- The two key commits (archive commit sha + schnapp-bet removal commit sha).
- A "what's next" pointer: try `/discover-kit-additions <any-repo>` or `/audit-against-kit schnapp-bet` to start growing the kit.

## Failure modes

- **Push fails partway** — retry per the user's exponential-backoff policy (2s, 4s, 8s, 16s). If it persists, leave the local state and report; do not force-push.
- **Archive directory already exists in schnapp-kit** (e.g. a previous failed run) — don't overwrite silently. Investigate, then either resume or write a `bootstrap-archive-v2/` if there's reason to keep both.
- **Bootstrap files in schnapp-bet have been modified since they were copied** — diff the archive vs the source; if real changes, copy the new versions before deleting. If only formatter changes, prefer the source.
