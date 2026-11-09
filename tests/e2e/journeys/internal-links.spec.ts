import { expect, test } from "./fixtures";

/**
 * Journey J-NAV-52: internal links go straight to the page they name. Read-only.
 *
 * The logo pointed at `/`, which answers 308 to `/jobs`, on every page; a signed-out
 * phone's Account tab pointed at `/settings`, which answers 307 to the sign-in page.
 * Each is a wasted round trip for a visitor and a redirect hop for a crawler. The
 * journey checks the two links by name, then follows every internal link on a few
 * pages without following redirects and fails on any that is one. A page of prose that names
 * "account settings" writes the sign-in address until the reader is known to be signed in.
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

test("the header logo opens /jobs directly", { tag: ["@J-NAV-52"] }, async ({ page, request }) => {
  await page.goto("/pricing");
  const logo = page.getByTestId("topbar-logo");
  await expect(logo).toBeVisible({ timeout: 20_000 });
  await expect(logo).toHaveAttribute("href", "/jobs");
  const res = await request.get("/jobs", { maxRedirects: 0 });
  expect(REDIRECT_STATUSES.has(res.status()), `/jobs answered ${res.status()}`).toBe(false);
});

test("a signed-out phone's Account tab opens the sign-in page for settings directly", { tag: ["@J-NAV-52"] }, async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the Account tab is the phone tab bar's");
  await page.goto("/pricing");
  const tab = page.getByTestId("mobile-topbar-account");
  await expect(tab).toBeVisible({ timeout: 20_000 });
  // Wait for the page to know nobody is signed in; it must stay on the sign-in address.
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(tab).toHaveAttribute("href", "/login?next=%2Fsettings");
  const res = await request.get("/login?next=%2Fsettings", { maxRedirects: 0 });
  expect(REDIRECT_STATUSES.has(res.status()), `the sign-in address answered ${res.status()}`).toBe(false);
});

for (const from of ["/pricing", "/about", "/blog", "/privacy", "/terms"]) {
  test(`${from}: no internal link on the page goes through a redirect`, { tag: ["@J-NAV-52"] }, async ({ page, request }) => {
    await page.goto(from);
    await expect(page.getByTestId("topbar-logo")).toBeVisible({ timeout: 20_000 });
    const hrefs = await page.locator("a[href^='/']:not([href^='//'])").evaluateAll((els) =>
      [...new Set(els.map((a) => (a as HTMLAnchorElement).getAttribute("href") as string))],
    );
    expect(hrefs.length).toBeGreaterThan(5);
    const redirecting: string[] = [];
    for (const href of hrefs) {
      const res = await request.get(href, { maxRedirects: 0 });
      if (REDIRECT_STATUSES.has(res.status())) redirecting.push(`${href} -> ${res.status()} ${res.headers()["location"] ?? ""}`);
    }
    expect(redirecting).toEqual([]);
  });
}
