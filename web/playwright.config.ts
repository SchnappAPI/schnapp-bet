import { defineConfig, devices } from "@playwright/test";

// Route-level E2E for the production web tier.
//
// These run against an ALREADY-RUNNING production build on :3001 — the launchd
// `bet.schnapp.web-prod` service in prod, or `npm run start` locally. There is
// deliberately no `webServer` block: the deploy gate
// (.github/workflows/deploy-web.yml) points this suite at the freshly-swapped
// prod process to decide ship-vs-rollback, so the server lifecycle is owned by
// launchd, not Playwright. Override the target with E2E_BASE_URL if needed.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry absorbs transient live-mssql / network blips without masking a
  // genuinely broken route (a broken route fails both attempts).
  retries: 1,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Block the production service worker. In prod the layout registers /sw.js,
    // which intercepts navigations and serves cached shell HTML — that makes
    // route-render assertions non-deterministic across deploys.
    serviceWorkers: "block",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
