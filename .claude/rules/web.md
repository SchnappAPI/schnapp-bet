---
paths:
  - "web/**/*.ts"
  - "web/**/*.tsx"
  - "web/**/*.json"
  - "web/**/*.css"
---

- Never hardcode hostnames, IPs, or connection strings. Read `process.env.*`.
- Flask routes read `process.env.RUNNER_URL`. Dev default: `http://127.0.0.1:5000`. Prod: `https://mac-flask.schnapp.bet`.
- Validate TypeScript before committing: `cd web && npx --no-install tsc --noEmit -p .`
- Never use `push_files` for TSX with non-ASCII Unicode. Use `create_or_update_file`.
- `revalidateOnFocus: false` on all SWR hooks.
- Deploy via `deploy-web.yml` workflow_dispatch only. Never build locally and copy.
- `isAdmin` derived from `localStorage.schnapp_admin_token` presence only.
- At a Glance: filter `model_version NOT LIKE 'mlb%'` to exclude MLB rows from NBA view.
- Dev server: prefer `next dev` over `next dev --turbopack` until the turbopack manifest race is resolved upstream. Symptom: `Internal Server Error` in browser + dev log spam of `ENOENT: ... _buildManifest.js.tmp.<random>`. Recovery: `pkill -f "next dev" && rm -rf web/.next && restart`.
- `tsc` must run from `web/`. From repo root, `npx tsc --noEmit -p .` finds no tsconfig and silently returns exit 0 — false negative. Canonical: `cd /Users/schnapp/code/schnapp-bet/web && npx --no-install tsc --noEmit -p .`. Empty stdout is only valid if `cd` happened.
- Auto-push (`.githooks/post-commit`) is not reliable; sometimes silent. After every `git commit`, run `git status`. If "ahead of origin by N", run `git push` manually before the next commit.
- For UI changes: hit the changed surface in dev once before stacking the next UI commit. Even `curl http://127.0.0.1:3002/<path>` and grep for expected text. Stacking 3+ UI commits without browser verification is the documented failure mode.
