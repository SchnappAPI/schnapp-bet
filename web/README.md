# Web

Area router for `/web/`. Next.js 15.2.8 app served at `schnapp.bet` by the `bet.schnapp.web-prod` launchd user agent on Schnapps-MBP (Cloudflare-proxied). Shell is live; per-sport pages vary in maturity.

## Per-sport docs

- `/web/nba/README.md` - STATUS: live
- `/web/mlb/README.md` - STATUS: in development (3 of 6 ADR-0003 pages coded, not considered live)
- `/web/nfl/README.md` - STATUS: not started
- `/web/_shared/README.md` - shared shell and cross-sport components

## Files

Next.js app structure: `app/` for routes, `components/` for shared components, `app/api/` for API routes. Sport-specific pages live under `app/<sport>/`. Build config in `next.config.js` and `staticwebapp.config.json`.

## Key Concepts

Passcode-gated access via `common.user_codes`. Demo mode fixes the view to a historical date per `common.demo_config`. The connected visual pattern drives multi-visual updates from a single selected player (see `/docs/PRODUCT_BLUEPRINT.md`).

Site-wide maintenance gate in `middleware.ts` runs before the passcode layer. The toggle is the `maintenance_mode` row in `common.feature_flags` (DB is authoritative, no constants, no env vars, no redeploy). The middleware reads the flag map with a 60-second in-process cache, so a flip propagates within a minute. To lock the site, open `/admin`, sign in with `ADMIN_PASSCODE`, go to the Visibility tab, toggle `maintenance_mode` on. To unlock yourself manually, visit any URL with `?unlock=go` once; the middleware sets the `sb_unlock=go` HttpOnly cookie for 30 days and 307-redirects to the clean URL. Signing into `/admin` also auto-grants `sb_unlock`, so admin auth doubles as an unlock. `/api/ping` is always allowed through so the DB keep-alive ping keeps working. On any DB read error the gate fails open. See `lib/feature-flags.ts` for the matching server-component helper used by sport and sub-page wrappers, and ADR-20260425-2 for the full design.

API routes talk to the Mac Flask runner (`bet.schnapp.flask` launchd agent on `127.0.0.1:5000`) via the `RUNNER_URL` plist env var: production is `https://mac-flask.schnapp.bet` (Cloudflare-proxied through the `schnapp-mac` tunnel), dev is `http://127.0.0.1:5000`. The old `https://live.schnapp.bet` hostname is no longer active.

## Invariants

- One Next.js app for all sports. No separate app per sport.
- Passcode check happens at the route layer before page content renders.
- Connected visual state lives at the page level, not inside individual components.

## Recent Changes

See `/docs/CHANGELOG.md` filtered by `[web]`.

## Open Questions

None at area level. Sport-specific questions live in the per-sport READMEs.
