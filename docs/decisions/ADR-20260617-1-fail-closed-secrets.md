# ADR-20260617-1: Fail closed on missing security secrets in production

Date: 2026-06-17

Related: ADR-20260517-5 (1Password is the single source of truth for runtime secrets) — this fulfills its Decision 6, which deferred removing the `runner-Lake4971` default "until the Flask service port is revisited."

## Context

Two security-critical secrets resolved to known, repo-published default strings when the real value failed to resolve at runtime:

- `AUTH_TOKEN_SECRET ?? 'fallback-dev-secret-change-me'` — the HMAC secret that signs and verifies the web session auth token. Read at `web/middleware.ts`, `web/app/api/auth/validate/route.ts`, and `web/app/api/auth/check/route.ts`. If `AUTH_TOKEN_SECRET` ever failed to resolve in production, every party that knows the published default (i.e. anyone reading the repo) could forge a valid session token — a silent auth bypass.
- `RUNNER_API_KEY ?? 'runner-Lake4971'` — the shared secret in the `X-Runner-Key` header between the web app and the Flask runner. Read at five web routes (`live-boxscore`, `game/[id]/on-court`, `scoreboard`, `games`, `games/today`) and validated in `services/flask/runner.py`. The default was effectively published in the repo, so anyone could impersonate the web app to the runner.

The `??` defaults made a production misconfiguration silent: auth kept "working" against a public string instead of failing.

A constraint shaped the fix: production runs `next start` on Schnapps-MBP with secrets injected at process start via `op run`. But `next build` runs with `NODE_ENV=production` and **without** the runtime secrets. So the secret must be resolved lazily, at request time — resolving at module top level would throw during the build.

## Decision

Fail closed in production; keep a dev-only default behind an explicit non-production guard.

1. **`web/lib/secrets.ts` — `requireSecret(name, devDefault)`.** Returns the env var when set. When unset: throws if `NODE_ENV === 'production'`; otherwise returns `devDefault`. Documented as MUST-call-lazily (never at module scope) so `next build` is unaffected.

2. **Auth routes** (`auth/validate`, `auth/check`) resolve `AUTH_TOKEN_SECRET` via `requireSecret` inside the handler. In production a missing secret throws, is caught by the existing handler `try/catch`, and returns HTTP 500 — no token is ever signed or verified against the default. `validate` resolves before any DB write so a misconfig fails fast without logging a spurious activation.

3. **Middleware** (`web/middleware.ts`, edge runtime) reads `process.env.AUTH_TOKEN_SECRET` directly inside `checkApiAuth`, after the non-production dev bypass. If unset in production it logs and returns HTTP 500 (`server misconfigured`); it never verifies against the default. `verifyAuthToken` now takes the secret as a parameter.

4. **Runner-proxy routes** resolve `RUNNER_API_KEY` via `requireSecret` at the point of use. The three dedicated proxies (`live-boxscore`, `on-court`, `scoreboard`) surface the failure as their existing error response. The two overlay routes (`games`, `games/today`) catch it and degrade to DB-only data (no live overlay). In all cases the repo-published default key is never sent to the runner in production.

5. **`services/flask/runner.py`** removes the `runner-Lake4971` default and raises `RuntimeError` at startup if `RUNNER_API_KEY` is unset, refusing to serve `/scoreboard` and `/boxscore` with a known key. This removes the legacy exception recorded in ADR-20260517-5 Decision 6. Local dev provides the key the same way launchd does — via `op run --env-file=.env.template`.

Both env vars are already mapped in `.env.template` as `op://` URIs, so no wiring change is needed; this is a code-side behavior change only.

## Consequences

- A missing security secret in production is now loud — an HTTP 500 (web) or a refused start (runner) — instead of a silent auth bypass against a public string.
- `next build` is unaffected: every secret read is lazy, so the production build never evaluates `requireSecret` with secrets absent.
- The `games` / `games/today` dashboards degrade gracefully (DB-only, no live scores) if `RUNNER_API_KEY` is missing, rather than failing the whole request; the dedicated proxy endpoints return an explicit error.
- Local development is unchanged: the web layer still falls back to the dev defaults when `NODE_ENV !== 'production'`, and the runner gets its key from `op run` as before.
- Verified: the Flask guard rejects an unset key at startup and rejects the old default with 401; the web layer typechecks clean (`tsc --noEmit`).
