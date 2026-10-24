import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journey J-SEO-10: the hosts a real browser contacts. A visitor's IP and the
 * companies they view must reach only the hosts below. Every request the page
 * makes is observed (including ones the fixtures later abort), so a new
 * third-party host — a logo CDN, an analytics beacon — fails here by name
 * instead of shipping silently. Read-only.
 */

/** Hosts a page may contact. Add one only with a reason, and disclose it on /privacy. */
export const ALLOWED_HOSTS: Record<string, string> = {
  "velai.app": "our own origin, including company logos at /logos/<domain>.png",
  "challenges.cloudflare.com": "Cloudflare Turnstile bot check, disclosed on /privacy",
  "api.workos.com": "WorkOS sign-in",
};
// static.cloudflareinsights.com (Cloudflare Web Analytics beacon) is deliberately absent.

/** Visits `paths` and returns every distinct request host seen, with one example URL each. */
async function hostsSeen(page: Page, paths: string[]): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  page.on("request", (r) => {
    const { protocol, hostname } = new URL(r.url());
    if (protocol === "http:" || protocol === "https:") seen.set(hostname, r.url());
  });
  for (const path of paths) {
    await page.goto(path);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  }
  return seen;
}

/** The first company page linked from the /co directory (letter page, then a company). */
async function aCompanyPath(page: Page): Promise<string> {
  await page.goto("/co");
  const letter = await page.locator('a[href^="/co/letter/"]').first().getAttribute("href");
  expect(letter, "/co lists no letter pages").toBeTruthy();
  await page.goto(letter as string);
  const company = await page.locator('a[href^="/co/"]:not([href^="/co/letter/"]):not([href="/co"])').first().getAttribute("href");
  expect(company, `${letter} lists no companies`).toBeTruthy();
  return company as string;
}

test("pages contact only the allowed hosts, and company logos are first-party", { tag: ["@J-SEO-10"] }, async ({ page, baseURL }) => {
  const own = new URL(baseURL ?? "http://localhost:3000").hostname;
  const company = await aCompanyPath(page);
  const seen = await hostsSeen(page, ["/", "/jobs?q=software%20engineer", company, "/privacy", "/login"]);

  const allowed = new Set([...Object.keys(ALLOWED_HOSTS), own]);
  const unexpected = [...seen].filter(([host]) => !allowed.has(host)).map(([host, url]) => `${host} (${url})`);
  expect(unexpected, "hosts contacted that are not in ALLOWED_HOSTS").toEqual([]);
  expect(seen.has("static.cloudflareinsights.com")).toBe(false);
});
