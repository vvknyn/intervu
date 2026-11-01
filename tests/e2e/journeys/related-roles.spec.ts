import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journey for the roles next to a typed title — see tests/journeys/CATALOG.md (J-JOBS-165).
 * Read-only: the search answer is replaced in the browser (no backend needed).
 *
 * Vivek, 2026-11-01: "feed it into our search engine so that the search also knows what to return". A title search
 * lists the postings with that title first, then the roles next to it (tier 3, read out of the title neighbour map)
 * under a line naming them, then the postings that only mention the title.
 */
const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Constructed postings (no real company). */
const posting = (n: number, title: string, company: string, tier: 1 | 2 | 3) => ({
  id: `66666666-0000-4000-8000-00000000000${n}`,
  title,
  company,
  company_domain: null,
  location: "Remote",
  work_type: "remote",
  employment_type: "full_time",
  experience_level: "mid",
  tags: [],
  apply_url: "https://example.com/apply",
  source: "journey",
  posted_at: new Date(Date.now() - 86_400_000).toISOString(),
  vacancy_status: "open",
  ghost_badge: "unscored",
  tier,
});

test("a title search lists the roles next to it after the title matches, under a line naming them, before the mentions", { tag: ["@J-JOBS-165"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  const hits = [
    posting(1, "Technical Account Manager", "Maple Relay", 1),
    posting(2, "Senior Technical Account Manager", "Prairie Stack", 1),
    posting(3, "Customer Success Manager", "Birch Cloud", 3),
    posting(4, "Solutions Engineer", "Harbour Grid", 3),
    posting(5, "Support Engineer", "Cedar Loop", 2),
  ];
  await page.route("**/api/jobs/search", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        hits,
        total: hits.length,
        tier1Total: 2,
        relatedTitles: ["Customer Success Manager", "Solutions Engineer"],
        backend: "meilisearch",
        configured: true,
        searchId: "journey-related-roles",
      }),
    }),
  );
  await page.goto("/jobs?q=technical%20account%20manager&sort=relevance");

  const rows = page.getByTestId("job-row");
  await expect(rows).toHaveCount(5, { timeout: 45_000 });
  const related = page.getByTestId("related-seam");
  await expect(related).toHaveText("Roles next to technical account manager: Customer Success Manager and Solutions Engineer");
  await expect(page.getByTestId("relevance-seam")).toHaveText(
    "2 roles match by title, company or keywords · 1 more mention it elsewhere in the posting",
  );

  // Order on the page: the two title matches, the line, the two related roles, the mentions line, the mention.
  // Polled: the list can redraw once after the first paint (it is read again whenever it is drawn again).
  const order = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="job-row"], [data-testid="related-seam"], [data-testid="relevance-seam"]')].map((el) =>
        el.getAttribute("data-testid") === "job-row" ? el.getAttribute("data-job-id")!.slice(-1) : el.getAttribute("data-testid"),
      ),
    );
  await expect.poll(order, { timeout: 15_000 }).toEqual(["1", "2", "related-seam", "3", "4", "relevance-seam", "5"]);
  expect(diagnostics.pageErrors).toEqual([]);
});
