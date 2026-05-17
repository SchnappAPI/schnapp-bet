---
globs: "web/**/*.ts, web/**/*.tsx, web/**/*.json, web/**/*.css"
---

- Never hardcode hostnames, IPs, or connection strings. Read `process.env.*`.
- Flask routes read `process.env.RUNNER_URL`. Dev default: `http://127.0.0.1:5000`. Prod: `https://mac-flask.schnapp.bet`.
- Validate TypeScript before committing: `cd web && npx --no-install tsc --noEmit -p .`
- Never use `push_files` for TSX with non-ASCII Unicode. Use `create_or_update_file`.
- `revalidateOnFocus: false` on all SWR hooks.
- Deploy via `deploy-web.yml` workflow_dispatch only. Never build locally and copy.
- `isAdmin` derived from `localStorage.schnapp_admin_token` presence only.
- At a Glance: filter `model_version NOT LIKE 'mlb%'` to exclude MLB rows from NBA view.
