import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    isRetryableMeiliFailure,
    isPostedTsPopulationSufficient,
    POSTED_TS_POPULATION_THRESHOLD,
    buildSearchBody,
    applyCompanySeam,
} from "../../src/lib/jobs/meilisearch";
import { FACETABLE_KEYS, REQUESTED_FACET_KEYS } from "../../src/lib/jobs/types";

const SERP_FILTERS_SRC = readFileSync(
    fileURLToPath(new URL("../../src/components/jobs/SerpFilters.tsx", import.meta.url)),
    "utf8",
);
// REQUESTED_FACET_KEYS covers two consumption shapes (see its doc,
// lib/jobs/types.ts): a generic FacetGroup rendered in SerpFilters.tsx, OR a
// bespoke reader of the facet's distribution elsewhere in the render path —
// e.g. ghost_badge's hide-count, computed in page.tsx from
// `facetDistribution?.ghost_badge`, never referenced by name in
// SerpFilters.tsx itself. The guard below has to scan that whole render
// path, not SerpFilters.tsx alone, or it wrongly flags every bespoke-reader
// key as unreferenced.
const RENDER_PATH_SRC =
    SERP_FILTERS_SRC +
    readFileSync(fileURLToPath(new URL("../../src/app/jobs/page.tsx", import.meta.url)), "utf8") +
    readFileSync(fileURLToPath(new URL("../../src/components/jobs/GhostRadarCard.tsx", import.meta.url)), "utf8");

// Phase 1-a #1: retry-policy decision — 5xx (transient) is retryable, 4xx
// (the request itself is wrong) never is.
test("isRetryableMeiliFailure: 5xx is retryable, 4xx and 2xx are not", () => {
    assert.equal(isRetryableMeiliFailure(500), true);
    assert.equal(isRetryableMeiliFailure(503), true);
    assert.equal(isRetryableMeiliFailure(400), false);
    assert.equal(isRetryableMeiliFailure(404), false);
    assert.equal(isRetryableMeiliFailure(429), false);
    assert.equal(isRetryableMeiliFailure(200), false);
});

// Phase 1-a #4: population-threshold decision — config presence (the field
// being filterable) lies; a bare > 0 headcount also lies on a near-empty
// partial backfill. Only a meaningful population passes.
test("isPostedTsPopulationSufficient requires both a nonzero count and a real fraction of the corpus", () => {
    assert.equal(isPostedTsPopulationSufficient(0, 1_000_000), false, "zero population never supported");
    assert.equal(isPostedTsPopulationSufficient(1, 1_000_000), false, "a token handful isn't real population");
    assert.equal(isPostedTsPopulationSufficient(500_000, 1_000_000), true, "half the corpus is clearly enough");
});

test("isPostedTsPopulationSufficient sits right at the documented threshold", () => {
    const total = 1_000_000;
    const atThreshold = Math.floor(total * POSTED_TS_POPULATION_THRESHOLD);
    const aboveThreshold = atThreshold + 1_000;
    assert.equal(isPostedTsPopulationSufficient(atThreshold, total), false, "exactly at the bar doesn't clear it");
    assert.equal(isPostedTsPopulationSufficient(aboveThreshold, total), true);
});

test("isPostedTsPopulationSufficient treats an empty/unknown corpus as unsupported", () => {
    assert.equal(isPostedTsPopulationSufficient(0, 0), false);
    assert.equal(isPostedTsPopulationSufficient(5, 0), false);
});

// Jul 24 incident: the probe answering "no" on its OWN failure made the app
// drop the default 30d posted filter and send match-all+facets browse queries
// exactly when the box was degraded. Probe failure must be "unknown" (null),
// never "unsupported" (false) — only a successful measurement may demote.
test("fetchPostedDateFilterSupported: probe failure is null (unknown), success measures population", async (t) => {
    process.env.MEILISEARCH_HOST = "https://meili.test";
    process.env.MEILISEARCH_SEARCH_KEY = "k";
    const { fetchPostedDateFilterSupported } = await import("../../src/lib/jobs/meilisearch");

    t.mock.method(globalThis, "fetch", async () => {
        throw new Error("ECONNRESET");
    });
    assert.equal(await fetchPostedDateFilterSupported(), null, "network failure → unknown");

    let call = 0;
    t.mock.method(globalThis, "fetch", async () => ({
        ok: true,
        json: async () => ({ totalHits: call++ === 0 ? 1_000_000 : 900_000 }),
    }));
    assert.equal(await fetchPostedDateFilterSupported(), true, "measured sufficient → supported");

    let call2 = 0;
    t.mock.method(globalThis, "fetch", async () => ({
        ok: true,
        json: async () => ({ totalHits: call2++ === 0 ? 1_000_000 : 0 }),
    }));
    assert.equal(await fetchPostedDateFilterSupported(), false, "measured zero population → unsupported");
});

test("F6: buildSearchBody requests only REQUESTED_FACET_KEYS, not the full FACETABLE_KEYS — 'source' costs a Meili facet computation on every search for a value nothing renders", () => {
    const body = buildSearchBody({ q: "", withFacets: true }, false);
    assert.deepEqual(body.facets, [...REQUESTED_FACET_KEYS]);
    assert.ok(FACETABLE_KEYS.includes("source"), "source stays a legal filter (?src=, MCP) — just not a requested facet");
    assert.ok(!body.facets!.includes("source"));
});

test("F6: buildSearchBody requests no facets at all when withFacets is falsy", () => {
    const body = buildSearchBody({ q: "" }, false);
    assert.equal(body.facets, undefined);
});

test("F6 guard: every REQUESTED_FACET_KEYS member is referenced somewhere in the render path (SerpFilters.tsx's generic FacetGroups, or a bespoke reader in page.tsx/GhostRadarCard.tsx)", () => {
    for (const key of REQUESTED_FACET_KEYS) {
        assert.ok(RENDER_PATH_SRC.includes(key), `render path never references "${key}" — drop it from REQUESTED_FACET_KEYS if it's truly unrendered (this is exactly the "source" bug this fix closes)`);
    }
});

test("F6 guard: 'source' is FACETABLE but deliberately absent from both the requested-keys list and the render path", () => {
    assert.ok(!REQUESTED_FACET_KEYS.includes("source"));
    assert.ok(!RENDER_PATH_SRC.includes('"source"'));
});

// Company-name seam: upsertJobs now overwrites `company` with
// displayCompanyBrand's cleaned form at the PUT boundary and carries the
// untouched feed value forward as `company_raw`, so every reader of a live
// search hit (SERP, typeahead, MCP tools, /companies/[slug]) inherits the
// same cleaning the render layer already applied, without re-deriving it.
test("applyCompanySeam: strips an ATS portal hostname to the humanized tenant name", () => {
    const seam = applyCompanySeam({ company: "jobs.greenhouse.io", company_domain: null, title: "" });
    assert.equal(seam.company, "Jobs");
    assert.equal(seam.company_raw, "jobs.greenhouse.io", "raw feed value survives untouched");
});

test("applyCompanySeam: strips a requisition-code prefix ('REQ123 Acme' -> 'Acme')", () => {
    const seam = applyCompanySeam({ company: "REQ123 Acme", company_domain: null, title: "" });
    assert.equal(seam.company, "Acme");
    assert.equal(seam.company_raw, "REQ123 Acme");
});

test("applyCompanySeam: prefers the brand tail of a '{slogan} - {brand}' name when the domain confirms it", () => {
    const seam = applyCompanySeam({
        company: "We build great things - Acme",
        company_domain: "acme.com",
        title: "",
    });
    assert.equal(seam.company, "Acme");
    assert.equal(seam.company_raw, "We build great things - Acme");
});

test("applyCompanySeam: strips a comma-form legal suffix ('Acme, Inc.' -> 'Acme')", () => {
    const seam = applyCompanySeam({ company: "Acme, Inc.", company_domain: null, title: "" });
    assert.equal(seam.company, "Acme");
    assert.equal(seam.company_raw, "Acme, Inc.");
});

test("applyCompanySeam is idempotent: re-running the seam on its own output is a no-op", () => {
    const first = applyCompanySeam({ company: "jobs.greenhouse.io", company_domain: null, title: "" });
    const second = applyCompanySeam({ company: first.company, company_domain: null, title: "" });
    assert.equal(second.company, first.company);
    assert.equal(second.company, "Jobs");
});

test("applyCompanySeam: null company with no domain falls back to null, not a fabricated string", () => {
    const seam = applyCompanySeam({ company: null, company_domain: null, title: "" });
    assert.equal(seam.company, null);
    assert.equal(seam.company_raw, null);
});

test("applyCompanySeam: empty-string company preserves displayCompanyBrand's existing domain fallback", () => {
    const withoutDomain = applyCompanySeam({ company: "", company_domain: null, title: "" });
    assert.equal(withoutDomain.company, null, "no domain to fall back to -> null, matching the ?? \"Unknown company\" nullish guard downstream");
    assert.equal(withoutDomain.company_raw, "", "raw stays the untouched empty string, never coerced to null");

    const withDomain = applyCompanySeam({ company: "", company_domain: "acme.com", title: "" });
    assert.equal(withDomain.company, "Acme", "empty company still resolves via the domain, same as displayCompany's existing fallback");
    assert.equal(withDomain.company_raw, "");
});
