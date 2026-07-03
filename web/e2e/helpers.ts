import type { BrowserContext, Page } from "@playwright/test";

const BASE_ORIGIN = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";

// The maintenance gate (web/middleware.ts) passes any request carrying the
// `sb_unlock=go` cookie straight through, regardless of the maintenance flag.
// Every spec sets it so a maintenance window never turns the deploy gate into
// a false rollback.
export async function setUnlockCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([
    { name: "sb_unlock", value: "go", url: BASE_ORIGIN },
  ]);
}

// Get past BOTH gates so specs can exercise authenticated app routes
// deterministically, without a real access code and without touching prod auth:
//   1. maintenance gate  -> `sb_unlock=go` cookie (see setUnlockCookie).
//   2. client PasscodeGate -> seed a localStorage token so verify() runs, then
//      stub /api/auth/check so it resolves to `authed`. ONLY auth is stubbed;
//      every data API (games, grades, flags, scoreboard) still hits real prod,
//      so a broken data route still surfaces as a console error or crash.
export async function primeAuth(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  await setUnlockCookie(context);

  // addInitScript runs before app scripts on every navigation, so the token is
  // present for PasscodeGate's first verify() call on initial load.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("schnapp_auth_token", "e2e-playwright");
      localStorage.setItem("schnapp_auth_mode", "live");
      localStorage.setItem("schnapp_demo_dates", "{}");
    } catch {
      // localStorage can be unavailable before the first same-origin document
      // exists; PasscodeGate re-reads it after navigation, so this is safe.
    }
  });

  await page.route("**/api/auth/check", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ valid: true, mode: "live", demoDates: {} }),
    }),
  );
}

// Collect browser-side failures (console.error output + uncaught exceptions)
// emitted during a page's lifetime. Specs assert this stays empty on load.
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}
