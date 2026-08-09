import { test, expect, type Page } from "@playwright/test";

/**
 * TEST GROUP: SEARCH-QUALITY-S1 — place-token hijack of company names
 *
 * Live-confirmed bug (search-audit.md class 1, 2026-08-08): a gazetteer city
 * inside a company name ("cleveland clinic") was silently consumed as a
 * location filter by `applyQueryUnderstanding` (query-understanding.ts), and
 * the employer intent died — zero of the top results were the real Cleveland
 * Clinic. Fixed with a company-corroboration guard: before committing a
 * place-strip on a multi-word query, a cheap company-scoped probe
 * (`probeCompanyMatch`, meilisearch.ts) checks whether the place token plus
 * an adjacent word matches a real employer; if so, the whole phrase stays
 * free text instead of being cut into a location filter.
 *
 * Drives the real production server (`next build` + `next start`, port
 * 3000 — same fidelity search-audit.md itself used) rather than a mock, so
 * this exercises the actual live-Meilisearch-backed request path, not a
 * fixture. Structural, not exact-copy assertions: what's under test is
 * WHICH interpretation won (employer vs. place), not any specific ranking
 * position beyond top-of-list.
 */

async function readTopRows(page: Page, n = 5): Promise<string[]> {
    const rows = page.locator('[data-testid="job-row"]');
    await rows.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    const count = await rows.count();
    const out: string[] = [];
    for (let i = 0; i < Math.min(count, n); i++) {
        out.push(((await rows.nth(i).textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
    }
    return out;
}

async function search(page: Page, q: string): Promise<string[]> {
    // `posted=any` bypasses the app's standing 30-day default window
    // (feedback-jobs-default-30d-filter.md / url-state.ts) — a real,
    // intentional, unrelated product default that would otherwise hide an
    // older-but-correct employer posting and confound what these tests are
    // actually isolating: the query-UNDERSTANDING decision, not recency.
    await page.goto(`/jobs?q=${encodeURIComponent(q)}&posted=any`, { waitUntil: "domcontentloaded" });
    // Debounced search (250ms) + network + render — same wait search-audit.md's
    // own UI-driven pass used after finding its first attempt under-waited.
    await page.waitForTimeout(1800);
    return readTopRows(page, 5);
}

test.describe("S1: company-vs-place query understanding", () => {
    test("'cleveland clinic' — the employer wins; Cleveland the CITY never eats the query as a bare location filter", async ({ page }) => {
        const top5 = await search(page, "cleveland clinic");
        expect(top5.length, `expected results for "cleveland clinic": ${JSON.stringify(top5)}`).toBeGreaterThan(0);
        const employerHit = top5.some((row) => /cleveland clinic/i.test(row));
        expect(employerHit, `expected at least one top-5 row naming Cleveland Clinic: ${JSON.stringify(top5)}`).toBe(true);
    });

    test("'boston consulting' — same class, a different city+company pair", async ({ page }) => {
        const top5 = await search(page, "boston consulting");
        expect(top5.length, `expected results for "boston consulting": ${JSON.stringify(top5)}`).toBeGreaterThan(0);
        const employerHit = top5.some((row) => /boston consulting/i.test(row));
        expect(employerHit, `expected at least one top-5 row naming Boston Consulting: ${JSON.stringify(top5)}`).toBe(true);
    });

    test("control: 'warehouse jobs in dallas' — Dallas place filter STILL applies (no company named that)", async ({ page }) => {
        const top5 = await search(page, "warehouse jobs in dallas");
        expect(top5.length, `expected results for "warehouse jobs in dallas": ${JSON.stringify(top5)}`).toBeGreaterThan(0);
        // Dallas-metro (the gazetteer's radius expansion — resolve-place.ts) —
        // any of these in the visible rows proves the PLACE filter narrowed
        // results, not a company-name interpretation swallowing the query.
        const dallasMetro = /dallas|fort worth|arlington|plano|irving|garland|mesquite/i;
        const placeFiltered = top5.some((row) => dallasMetro.test(row));
        expect(placeFiltered, `expected Dallas-metro rows when the place filter still applies: ${JSON.stringify(top5)}`).toBe(true);
    });

    test("control: 'jobs in boston' — place filter still applies", async ({ page }) => {
        const top5 = await search(page, "jobs in boston");
        expect(top5.length, `expected results for "jobs in boston": ${JSON.stringify(top5)}`).toBeGreaterThan(0);
        const bostonMetro = /boston|cambridge|somerville|quincy|newton|brookline/i;
        const placeFiltered = top5.some((row) => bostonMetro.test(row));
        expect(placeFiltered, `expected Boston-metro rows when the place filter still applies: ${JSON.stringify(top5)}`).toBe(true);
    });

    test("control: a bare single-word 'cleveland' is unchanged — still a place browse, not a company search", async ({ page }) => {
        const top5 = await search(page, "cleveland");
        expect(top5.length, `expected results for "cleveland": ${JSON.stringify(top5)}`).toBeGreaterThan(0);
        const clevelandMetro = /cleveland|akron|parma|lakewood|strongsville/i;
        const placeFiltered = top5.some((row) => clevelandMetro.test(row));
        expect(placeFiltered, `expected Cleveland-metro rows for a bare place query: ${JSON.stringify(top5)}`).toBe(true);
    });
});
