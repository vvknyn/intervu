import { expect, test } from "./fixtures";

/**
 * Journeys J-SEO-05, J-SEO-07, J-SEO-11 and J-SEO-12: what a crawler and a
 * browser get in a page's head and headers. Read-only (the report POST only
 * writes one server log line).
 */

const MONTH_SECONDS = 30 * 24 * 3600;

const maxAge = (cacheControl: string | undefined) => Number(/max-age=(\d+)/.exec(cacheControl ?? "")?.[1] ?? 0);

test("marketing pages name themselves as their canonical, /openclaw included", { tag: ["@J-SEO-05"] }, async ({ page }) => {
  for (const path of ["/pricing", "/about", "/connect", "/indeed-alternative", "/openclaw", "/accessibility"]) {
    await page.goto(path);
    const links = page.locator('link[rel="canonical"]');
    await expect(links, `${path} has exactly one canonical`).toHaveCount(1);
    const href = await links.getAttribute("href");
    expect(new URL(href!).pathname, `${path} canonicalises to itself`).toBe(path);
  }
});

test("a page is served the security headers, an enforced policy and a report-only one that reports", { tag: ["@J-SEO-07"] }, async ({ request }) => {
  const res = await request.get("/pricing");
  const h = res.headers();
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");

  const enforced = h["content-security-policy"];
  for (const directive of ["img-src 'self' data: blob:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"]) {
    expect(enforced, directive).toContain(directive);
  }
  const reportOnly = h["content-security-policy-report-only"];
  expect(reportOnly).toContain("script-src 'self'");
  expect(reportOnly).toContain("report-uri /api/csp-report");
  expect(reportOnly).toContain("report-to csp-endpoint");
  expect(h["reporting-endpoints"]).toContain('csp-endpoint="/api/csp-report"');
});

test("public images are cached for a month and build files for a year, never re-asked on every visit", { tag: ["@J-SEO-11"] }, async ({ page, request }) => {
  const image = await request.get("/velai-tile.png");
  expect(image.status()).toBe(200);
  const imageCache = image.headers()["cache-control"];
  expect(maxAge(imageCache), `/velai-tile.png: ${imageCache}`).toBeGreaterThanOrEqual(MONTH_SECONDS);
  expect(imageCache).not.toContain("immutable");

  await page.goto("/pricing");
  const built = await page.locator("script[src^='/_next/static/']").first().getAttribute("src");
  const chunk = await request.get(built!);
  expect(chunk.headers()["cache-control"]).toContain("immutable");
  expect(maxAge(chunk.headers()["cache-control"])).toBeGreaterThanOrEqual(365 * 24 * 3600);
});

test("a browser's policy-violation report is accepted with no body", { tag: ["@J-SEO-12"] }, async ({ request }) => {
  const res = await request.post("/api/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: JSON.stringify({ "csp-report": { "document-uri": "https://velai.app/journey-check", "effective-directive": "img-src", "blocked-uri": "https://example.com/x.png", disposition: "report" } }),
  });
  expect(res.status()).toBe(204);
  expect(await res.text()).toBe("");
});
