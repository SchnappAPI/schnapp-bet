// public-paths.ts
//
// Single source of truth for routes that render OUTSIDE the passcode gate and
// the app shell chrome — public, unauthenticated, full-bleed pages such as QR
// landing pages. Both PasscodeGate and Shell consult this so the two never
// drift (a path exempted from the gate but not the shell would render the app
// sidebar around a public page, and vice versa).
//
// Matches an exact path or any subpath (e.g. '/naa' matches '/naa' and
// '/naa/anything'). Add a prefix here to expose a new public route.

export const PUBLIC_PATH_PREFIXES = ['/naa'] as const;

export function isPublicPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return PUBLIC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}
