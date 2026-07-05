import { NextResponse, type NextRequest } from "next/server";

// Site-wide gates driven by the `common.feature_flags` table. Flags are
// fetched via /api/flags and cached in module memory for CACHE_MS so the
// DB sees at most one read per minute per function instance. Failing
// open on any error is deliberate — the gate exists to discourage
// casual visitors during work, not to enforce security.

const COOKIE_NAME = "sb_unlock";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const UNLOCK_CODE = "go";
const CACHE_MS = 60_000;

// API auth — paths matching this prefix require a valid X-Auth-Token header
// in production. The token is the same payload.signature shape produced by
// /api/auth/validate and verified by /api/auth/check.
//
// Scoped narrowly to /api/search because every other data route (grades,
// player, games) has been openly fetched without an auth header by the
// existing client code for the life of the app. Expanding the gate would
// break production until the SWR fetcher wires the token through. Search
// is the new endpoint flagged by the deliberation as a scrape vector for
// the players table — that's the one we actually need to protect today.
const API_AUTH_PATH_RE = /^\/api\/search(\/|$)/;

// Edge-runtime safe HMAC-SHA256 → base64url. The auth/validate route uses
// node:crypto.createHmac with base64url encoding; we mirror that shape using
// the Web Crypto API so middleware runs unchanged on the edge.
function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifyAuthToken(
  token: string,
  secret: string,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!payload || !signature) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const expected = base64UrlEncode(new Uint8Array(sigBuf));
  // Constant-ish-time compare — token sizes are fixed so a length check is fine.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

let cachedFlags: Record<string, boolean> | null = null;
let cachedAt = 0;

async function getFlags(req: NextRequest): Promise<Record<string, boolean>> {
  const now = Date.now();
  if (cachedFlags && now - cachedAt < CACHE_MS) return cachedFlags;
  try {
    const url = new URL("/api/flags", req.url);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`flags fetch ${res.status}`);
    const data = (await res.json()) as Record<string, boolean>;
    cachedFlags = data;
    cachedAt = now;
    return data;
  } catch {
    // Fail open: return last good cache if we have one, else empty map.
    return cachedFlags ?? {};
  }
}

const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Scheduled Maintenance</title>
<style>
  html,body{margin:0;padding:0;height:100%;background:#0b0b0c;}
  body{
    color:#a8a8ad;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;
    text-align:center;padding:24px;
  }
  .wrap{max-width:420px;}
  h1{font-size:18px;font-weight:500;margin:0 0 10px;color:#d6d6d9;letter-spacing:.2px;}
  p{font-size:14px;line-height:1.6;margin:0;}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Scheduled maintenance</h1>
    <p>Migrating data and recalibrating</p>
  </div>
</body>
</html>`;

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // /fish is a standalone public page — always let it through regardless
  // of maintenance mode or any other gate.
  if (pathname === "/fish" || pathname.startsWith("/fish/")) {
    return NextResponse.next();
  }

  // /mascot is the public Schnappy character sheet + SVG assets — shareable
  // without an unlock code. Bare /mascot rewrites to the static index.html
  // (public/ has no directory-index behavior). Rewrite is internal, so the
  // tunnel-origin redirect problem does not apply.
  if (pathname === "/mascot" || pathname === "/mascot/") {
    const url = request.nextUrl.clone();
    url.pathname = "/mascot/index.html";
    return NextResponse.rewrite(url);
  }
  if (pathname.startsWith("/mascot/")) {
    return NextResponse.next();
  }

  // Bypass list for paths that must always be reachable, even during
  // maintenance: keep-alive ping, the flags endpoint itself (middleware
  // calls it), and /admin + /api/admin/* so the operator can always
  // sign in to flip the toggle back off.
  if (
    pathname === "/api/ping" ||
    pathname === "/api/flags" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin/")
  ) {
    return NextResponse.next();
  }

  // Unlock attempt via query string. Always honored, even if maintenance
  // is off — sets the bypass cookie so future locks let you through.
  //
  // No redirect, deliberately: behind the cloudflared tunnel the request's
  // origin is the internal bind (localhost:3001), so an absolute redirect
  // built from nextUrl points at a dead host, and the edge runtime rejects
  // a hand-built 3xx with a relative Location (500 in prod, 2026-07-05).
  // Setting the cookie and serving the page directly has no failure mode;
  // the ?unlock=go param simply stays in the URL.
  if (searchParams.get("unlock") === UNLOCK_CODE) {
    const res = NextResponse.next();
    res.cookies.set({
      name: COOKIE_NAME,
      value: UNLOCK_CODE,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });
    return res;
  }

  // Cookie present and matches: pass through regardless of maintenance.
  if (request.cookies.get(COOKIE_NAME)?.value === UNLOCK_CODE) {
    return NextResponse.next();
  }

  const flags = await getFlags(request);
  if (!flags["maintenance_mode"]) {
    // Maintenance is off — fall through to API auth gate below.
    return await checkApiAuth(request);
  }

  // Status 200, not 503. 503 was the technically-correct semantic for
  // "service unavailable, retry later", but Azure SWA's deployment warmup
  // probes anonymous traffic against the new revision and treats any 5xx
  // as unhealthy, retrying until a ~10 minute timeout and then failing
  // the deploy. With maintenance_mode on at deploy time, every SWA deploy
  // gets bricked. See ADR-20260426-1. The maintenance HTML has
  // noindex,nofollow so 200 does not cause SEO issues.
  return new NextResponse(MAINTENANCE_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function checkApiAuth(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (!API_AUTH_PATH_RE.test(pathname)) return NextResponse.next();

  // Dev bypass: in non-production we let unauthenticated traffic through so
  // local development without a populated common.user_codes table still
  // works. Production always requires the X-Auth-Token header.
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  // Fail closed: a missing signing secret in production means we cannot trust
  // any token. Reject rather than fall back to a known default string, which
  // would let anyone forge a valid session. See ADR-20260617-1.
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret) {
    console.error(
      "AUTH_TOKEN_SECRET is not set; rejecting authenticated request.",
    );
    return NextResponse.json(
      { error: "server misconfigured" },
      { status: 500 },
    );
  }

  const token = request.headers.get("x-auth-token");
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ok = await verifyAuthToken(token, secret);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-192\\.png|icon-512\\.png|manifest\\.json|sw\\.js|robots\\.txt|sitemap\\.xml).*)",
  ],
};
