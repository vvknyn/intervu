import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANDING_PROVENANCE_LINE, FOOTER_PROVENANCE_LINE, CORPUS_SOURCE_DESCRIPTOR } from "../../src/lib/marketing-stats";

/* ------------------------ LANDING_PROVENANCE_LINE ------------------------ */

test("the landing claim states provenance", () => {
    assert.match(LANDING_PROVENANCE_LINE, new RegExp(CORPUS_SOURCE_DESCRIPTOR));
});

test("the landing claim states no count — the live count line owns that number", () => {
    // Was `marketingClaim(stats)`, which opened with the live figure. Once the
    // count moved to its own linked line above the search box (2026-08-24) the
    // same number was on screen twice, ~90px apart, from two owners that could
    // disagree. The class-wide version of this guard, over every guest-surface
    // string rather than this one, lives in guest-copy-jargon.test.ts.
    assert.doesNotMatch(LANDING_PROVENANCE_LINE, /\d/);
});

test("the landing and footer claims share one descriptor rather than two wordings", () => {
    assert.match(FOOTER_PROVENANCE_LINE, new RegExp(CORPUS_SOURCE_DESCRIPTOR));
    assert.match(LANDING_PROVENANCE_LINE, new RegExp(CORPUS_SOURCE_DESCRIPTOR));
});

/* ------------------------- ITEM U: single cache chokepoint ------------------------ */
// 2026-08-15 (Vivek screenshot): the TopBar ticker and the /trends
// "Live jobs right now" card disagreed by 595 because each read the same
// Meili aggregation through its OWN cache instance on its own window
// (900s vs a 1800s page-level ISR riding an uncached call). The fix moved
// the one `unstable_cache` wrapper into market-trends.ts as
// `getCachedMarketTrends` and pointed every consumer at it. These are
// grep-proof regression tests (this repo has no component-render harness) —
// they guard against a future edit re-introducing a second cache instance
// or letting the /trends page's ISR window drift past the loader's own.

const marketTrendsSrc = readFileSync(new URL("../../src/lib/jobs/market-trends.ts", import.meta.url), "utf8");
const marketingActionSrc = readFileSync(new URL("../../src/actions/marketing.ts", import.meta.url), "utf8");
const trendsPageSrc = readFileSync(new URL("../../src/app/trends/page.tsx", import.meta.url), "utf8");

test("ITEM U: exactly one unstable_cache instance wraps fetchMarketTrends, in market-trends.ts", () => {
    assert.match(marketTrendsSrc, /export const getCachedMarketTrends = unstable_cache\(/);
    assert.doesNotMatch(marketingActionSrc, /unstable_cache/, "actions/marketing.ts must reuse the shared loader, not define its own");
    assert.doesNotMatch(trendsPageSrc, /unstable_cache/, "trends/page.tsx must reuse the shared loader, not define its own");
});

test("ITEM U: both consumers import the shared loader rather than calling fetchMarketTrends directly", () => {
    assert.match(marketingActionSrc, /import \{ getCachedMarketTrends \} from "@\/lib\/jobs\/market-trends"/);
    assert.match(trendsPageSrc, /import \{ getCachedMarketTrends \} from "@\/lib\/jobs\/market-trends"/);
    assert.doesNotMatch(trendsPageSrc, /\bfetchMarketTrends\(\)/, "the page must not bypass the shared cache with a direct call");
});

test("ITEM U: /trends' own ISR window is no wider than the shared loader's revalidate window (900s) — a wider page-level window would stack a second staleness clock on top of the cache's own", () => {
    const loaderRevalidate = Number(marketTrendsSrc.match(/\{ revalidate: (\d+) \}/)?.[1]);
    const pageRevalidate = Number(trendsPageSrc.match(/export const revalidate = (\d+)/)?.[1]);
    assert.ok(loaderRevalidate > 0 && pageRevalidate > 0, "both revalidate windows must be found in source");
    assert.ok(pageRevalidate <= loaderRevalidate, `page revalidate (${pageRevalidate}) must not exceed the loader's (${loaderRevalidate})`);
});
