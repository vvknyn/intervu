import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { rateLimitedSearchResult, SEARCH_RATE_LIMITED_MESSAGE, SEARCH_UNAVAILABLE_MESSAGE } from "../../../src/lib/jobs/result-state";
import { expect, test } from "./fixtures";
import { answerListSearch, isListSearch } from "./list-search";

/**
 * A search the per-IP limit turns away says so — see tests/journeys/CATALOG.md (J-SRCH-45). Read-only.
 *
 * R70 prod checks: the limit (40 searches a minute per connection) answered with the outage note, so a person who
 * tripped it read the site as down. The list search is answered in the browser with exactly what the server sends
 * then (`rateLimitedSearchResult`); the real limit is not tripped, since that would turn away every other journey
 * running from the same machine for a minute.
 */
test("a search turned away for searching too fast says so, not that search is down", { tag: ["@J-SRCH-45"] }, async ({ page, diagnostics }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  await page.route("**/*", (route) =>
    isListSearch(route.request()) ? answerListSearch(route, rateLimitedSearchResult("meilisearch", "journey-rate-limited")) : route.fallback(),
  );
  await page.goto("/jobs?q=product%20manager");

  const failed = page.getByTestId("jobs-search-error");
  await expect(failed).toBeVisible({ timeout: 45_000 });
  await expect(failed).toContainText(SEARCH_RATE_LIMITED_MESSAGE);
  await expect(page.getByText(SEARCH_UNAVAILABLE_MESSAGE)).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});
