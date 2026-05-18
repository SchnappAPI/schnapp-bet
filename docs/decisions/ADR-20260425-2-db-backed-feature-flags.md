# ADR-20260425-2: DB-backed feature flags as the runtime visibility surface

Date: 2026-04-25

## Context

Three operational needs converged. First, maintenance mode was a hardcoded constant in `web/middleware.ts` that required a commit-and-push (and a 90-second redeploy) every time it flipped. Second, with NBA shipping ahead of MLB and MLB ahead of NFL, individual sports and sub-pages periodically need to be hidden from end users without removing the underlying code. Third, the existing inline `RefreshDataButton` on NBA pages required a separate `ADMIN_REFRESH_CODE` prompt every time, even though the same admin already had a session at `/admin`. A single source of truth that handles all three, editable from a phone in seconds, was preferable to growing the env-var surface.

## Decision

Introduce `common.feature_flags` (`flag_key VARCHAR(100) PK`, `enabled BIT`) as the single runtime visibility surface. The DB is authoritative; no env vars, no Azure portal flips, no commits to toggle. Seed seven flags on creation: `maintenance_mode`, `sport.nba`, `sport.mlb`, `sport.nfl`, `page.nba.grades`, `page.nba.player`, `page.mlb.main`. Future pages add one row plus one line in the admin UI list.

Reads happen in two places, both with a 60-second in-process cache so DB load is at most one read per minute per instance:

- `web/middleware.ts` reads `maintenance_mode` to drive the maintenance gate.
- `web/lib/feature-flags.ts` exports `isPageVisible(flagKey)` for server components. Sport pages call it with `sport.<x>`; sub-pages with `page.<x>.<y>`.

Three layered behaviors:

1. **Cascade.** A `page.<sport>.<x>` lookup short-circuits to false if its parent `sport.<sport>` flag is explicitly disabled. Disabling NBA hides every NBA sub-page in one flip.
2. **Admin bypass.** Any visitor with the `sb_unlock=go` cookie passes every gate. The cookie is set automatically by `/api/admin/*` on successful auth, so signing into `/admin` simultaneously authenticates and unlocks every disabled surface for that browser. The `?unlock=go` URL is preserved for the same flow without an admin sign-in.
3. **Fail open.** Any DB error in `loadFlags()` returns the previously-cached map (or empty on cold start). The site stays up if the database stalls; flag flips are best-effort.

Admin UI extends `/admin` with three tabs (Codes, Visibility, Tools). Visibility renders one row per flag with an enable/disable toggle hitting `/api/admin/flags`. Tools holds the relocated Refresh Data button, which reads the admin session header instead of prompting for `ADMIN_REFRESH_CODE`. The discreet entry to `/admin` is a triple-tap on the top-left 32×32 corner of any page.

## Consequences

- `web/middleware.ts` no longer carries a `MAINTENANCE_ON` constant. The maintenance flow is DB-backed.
- Adding a new gated page is a two-line change: insert one row into `common.feature_flags`, add one `if (!(await isPageVisible(...)))` line at the top of the page wrapper.
- The `ADMIN_REFRESH_CODE` env var stays defined for backward compatibility but is no longer the primary refresh entry point.
- DB read adds latency (~50ms cold, sub-1ms warm cache). Flag flip takes up to 60 seconds to propagate across instances. Acceptable for an operator tool, not user-facing latency-sensitive logic.
- Surface area is larger than the constant it replaces: a DB table, two API routes, a server helper, an admin UI section, page-wrapper edits across every sport. Benefit: live, reversible flips from a phone with no push.

## Alternatives considered

- Env vars in Azure SWA app settings: rejected because Azure portal flips are slow on mobile.
- Single global JSON in blob storage: viable but introduces a second source of truth alongside the existing DB-backed admin codes table.
- Per-sport hardcoded constants with deploys: same redeploy-on-flip problem.
