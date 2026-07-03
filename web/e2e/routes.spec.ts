import { test, expect } from "@playwright/test";
import { primeAuth, setUnlockCookie, trackPageErrors } from "./helpers";

// Route-level smoke E2E for the shipping surfaces. Assertions are structural,
// never on data content: the grids are live-mssql and legitimately empty on
// off-days, so we verify each route MOUNTS its own chrome and loads without
// browser errors — the class of failure a single homepage curl cannot catch.

test.describe("authenticated shipping routes", () => {
  test.beforeEach(async ({ context, page }) => {
    await primeAuth(context, page);
  });

  // Top-level sport landings render an always-present tab strip
  // (Games / Players) regardless of whether games exist for the day.
  for (const path of ["/nba", "/mlb"]) {
    test(`${path} renders its data landing without console errors`, async ({
      page,
    }) => {
      const errors = trackPageErrors(page);

      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status(), `HTTP status for ${path}`).toBeLessThan(400);

      // Auth was primed, so the passcode gate must be gone...
      await expect(
        page.getByText("Enter your access code to continue"),
      ).toHaveCount(0);

      // ...and the route's own tab strip must have mounted.
      await expect(
        page.getByRole("button", { name: "Games", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Players", exact: true }),
      ).toBeVisible();

      // No Next.js client-exception crash page.
      await expect(page.getByText("Application error")).toHaveCount(0);

      expect(
        errors,
        `console errors on ${path}:\n${errors.join("\n")}`,
      ).toEqual([]);
    });
  }

  // The At-a-Glance grades grid is the actual @tanstack/react-table surface the
  // deploy gate exists to protect. The grid renders its column-header row from
  // static column defs even at "0 rows", so we assert that STRUCTURE (a table
  // with a Player column) — never the live-mssql cell values.
  test("/nba/grades renders the @tanstack data grid structure", async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    const res = await page.goto("/nba/grades", {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status(), "HTTP status for /nba/grades").toBeLessThan(400);

    await expect(page.getByRole("table")).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Player", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Application error")).toHaveCount(0);

    expect(
      errors,
      `console errors on /nba/grades:\n${errors.join("\n")}`,
    ).toEqual([]);
  });

  // NFL is a deliberate placeholder (app/nfl/page.tsx returns <ComingSoon/>),
  // so there is no grid to assert — verify it still loads cleanly.
  test("/nfl renders the placeholder without console errors", async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    const res = await page.goto("/nfl", { waitUntil: "domcontentloaded" });
    expect(res?.status(), "HTTP status for /nfl").toBeLessThan(400);

    await expect(page.getByText("Coming soon", { exact: false })).toBeVisible();
    await expect(page.getByText("Application error")).toHaveCount(0);

    expect(errors, `console errors on /nfl:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("passcode gate (unauthenticated)", () => {
  // No auth priming: only the maintenance-bypass cookie, so an anonymous
  // visitor reaches the client access-code gate (not the maintenance page).
  // This is a real public-facing surface and must render error-free.
  test("/nba shows the access-code gate to anonymous visitors", async ({
    context,
    page,
  }) => {
    await setUnlockCookie(context);
    const errors = trackPageErrors(page);

    const res = await page.goto("/nba", { waitUntil: "domcontentloaded" });
    expect(res?.status(), "HTTP status for gate").toBeLessThan(400);

    await expect(
      page.getByText("Enter your access code to continue"),
    ).toBeVisible();

    expect(errors, `console errors on gate:\n${errors.join("\n")}`).toEqual([]);
  });
});
