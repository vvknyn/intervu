import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { marketingClaim, CORPUS_SOURCE_DESCRIPTOR } from "../../src/lib/marketing-stats";

/* ----------------------------- marketingClaim ----------------------------- */

test("marketingClaim degrades to copy without a number when stats are null", () => {
    const claim = marketingClaim(null);
    assert.match(claim, new RegExp(CORPUS_SOURCE_DESCRIPTOR));
    assert.doesNotMatch(claim, /\d/, "no digit should appear when the corpus count is unknown");
});

test("marketingClaim renders an exact live-jobs count", () => {
    const claim = marketingClaim({ liveJobs: { kind: "exact", value: 12345 } });
    assert.match(claim, /12,345 live roles/);
    assert.match(claim, new RegExp(CORPUS_SOURCE_DESCRIPTOR));
});

test("marketingClaim renders a floor count with the honest '+' suffix", () => {
    const claim = marketingClaim({ liveJobs: { kind: "floor", value: 100_000 } });
    assert.match(claim, /100,000\+ live roles/);
});

test("marketingClaim never fabricates a count for a zero-value exact stat", () => {
    // Zero is a real, reportable count — distinct from `null` (unknown). The
    // claim should still render the number, not silently fall back to the
    // numberless copy.
    const claim = marketingClaim({ liveJobs: { kind: "exact", value: 0 } });
    assert.match(claim, /^0 live roles/);
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
