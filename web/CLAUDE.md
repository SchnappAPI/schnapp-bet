# web/CLAUDE.md

Next.js 15 app served by launchd `bet.schnapp.web-prod` on Schnapps-MBP (port 3001).
Production at schnapp.bet via Cloudflare tunnel.

## Stack

TypeScript, Tailwind CSS, SWR for client fetches, mssql v11 for DB access from API routes.
DB connection via `SQL_CONNECTION_STRING` env var read by `web/lib/db.ts`.

## Rules

- Never hardcode hostnames, IPs, or connection strings. Read `process.env.*` or inject via
  the launchd plist.
- Flask live-data routes read `process.env.RUNNER_URL`. Default in dev: `http://127.0.0.1:5000`.
  Production: `https://mac-flask.schnapp.bet`. Never hardcode either value.
- Validate TypeScript before committing: `cd web && npx --no-install tsc --noEmit -p .`
- Never use `push_files` for TSX files containing non-ASCII Unicode (arrows, em dashes,
  curly quotes). Use `create_or_update_file`. Corruption produces client-side JS crashes.
- API routes that change schema or query logic: verify downstream UI consumers still work
  after the change.
- `revalidateOnFocus: false` on all SWR hooks. Do not enable focus revalidation.
- Deploying: trigger `deploy-web.yml` (workflow_dispatch on mac-runner). It clones from
  GitHub, runs `npm ci` and `npm run build`, and restarts `bet.schnapp.web-prod`.
  Do not build locally and copy files.

## Auth

- Passcode gate (`PasscodeGate.tsx`) guards the app. `isAdmin` derived from
  `localStorage.schnapp_admin_token` presence.
- `/api/search` is auth-gated via `web/middleware.ts`. Other API routes are not auth-gated
  at the middleware level.
- Admin pages enforce their own server-side `ADMIN_PASSCODE` check.

## Canonical UI rules — do not revert

- Compact stats columns: MIN PTS 3PM REB AST PRA PR PA RA.
- All Stats adds: FG 3PA FT STL BLK TOV.
- StatsTable colSpanTotal: compact=11, all-stats=17.
- Today's Props: horizontal strip flex-1 cells, tap to expand dot plot and alt panel.
- RosterTable: "Confirmed" badge only when lineupStatus=Confirmed.
- At a Glance: default minOdds=-600, ODDS_MIN=-1000. getGrades reads dg.outcome_name and
  dg.over_price directly. Filter: `model_version NOT LIKE 'mlb%'` to exclude MLB rows.
