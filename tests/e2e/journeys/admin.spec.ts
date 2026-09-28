import { expect, test } from "./fixtures";

/** Journeys for /admin — see tests/journeys/CATALOG.md (J-ADMIN-*). Read-only. */

test("signed-out visitor opening /admin is sent to /login?next=/admin", { tag: ["@J-ADMIN-01"] }, async ({ page, diagnostics }) => {
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/login\?/);
  const landed = new URL(page.url());
  expect(landed.pathname).toBe("/login");
  expect(landed.searchParams.get("next")).toBe("/admin");
  expect(diagnostics.serverErrors).toEqual([]);
});
