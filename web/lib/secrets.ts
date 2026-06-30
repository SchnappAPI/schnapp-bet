// Fail-closed resolution of security-critical runtime secrets.
//
// Returns the named env var when it is set. When it is unset:
//   - production (NODE_ENV === 'production'): throws. We refuse to fall back
//     to a default string, because a repo-published default silently enables
//     the exact attack the secret defends against — session-token forgery for
//     AUTH_TOKEN_SECRET, runner impersonation for RUNNER_API_KEY. Failing
//     closed turns a silent auth bypass into a loud 500. See ADR-20260617-1.
//   - non-production: returns `devDefault` so local dev without the full
//     secret set still works.
//
// MUST be called lazily, inside a request handler — never at module top level.
// `next build` runs with NODE_ENV=production but without the runtime secrets
// (those are injected at `next start` via `op run`), so a module-scope call
// would throw during the build.
export function requireSecret(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${name} is not set; refusing to use a default secret in production.`,
    );
  }
  return devDefault;
}
