import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    EARLY_FIRST_SEARCH_TTL_MS,
    SEARCH_FIRST_PAGE_SIZE,
    earlyFirstSearchParams,
    resetEarlyFirstSearchForTests,
    searchParamsKey,
    startEarlyFirstSearch,
    takeEarlyFirstSearch,
} from "../../src/lib/jobs/early-first-search";
import { buildJobSearchPayload } from "../../src/lib/jobs/search-payload";
import type { JobSearchParams } from "../../src/lib/jobs/types";
import { parseJobsUrl } from "../../src/lib/jobs/url-state";

const ROOT = path.resolve(__dirname, "../..");

test("only a typed search landing gets an early first search", () => {
    assert.equal(earlyFirstSearchParams("", false), null, "bare /jobs: no list until there is a reason");
    assert.equal(earlyFirstSearchParams("?q=%20%20", false), null);
    assert.equal(earlyFirstSearchParams("?country=CA", false), null, "filters only: left to JobsContent");
    assert.equal(earlyFirstSearchParams("?q=nurse&sort=fit", false), null, "résumé fit sends a deeper page");
    assert.equal(earlyFirstSearchParams("?q=nurse&view=for-you", false), null, "For you sends a deeper page");
    assert.ok(earlyFirstSearchParams("?q=nurse", false));
    assert.ok(earlyFirstSearchParams("?q=nurse&view=search&job=abc", false));
});

test("the early request is the one JobsContent's first search sends for the URL", () => {
    // JobsContent seeds its state from parseJobsUrl, sorts a query by
    // relevance (resolveEffectiveSort with no override), starts with the date
    // sort supported, and asks for PAGE rows with facets.
    const state = parseJobsUrl(new URLSearchParams("?q=nurse&country=CA&work=remote"));
    const expected: JobSearchParams = {
        ...buildJobSearchPayload(
            {
                facets: state.facets,
                salaryMin: state.salaryMin,
                visaOnly: state.visaOnly,
                postedBucket: state.postedBucket,
                postedExplicit: state.postedExplicit || undefined,
                yearsExperience: state.yearsExperience,
                hideGhosts: state.hideGhosts,
                board: state.board,
                companyDomain: state.companyDomain,
            },
            "nurse",
            "relevance",
            true,
            undefined,
        ),
        withFacets: true,
        limit: SEARCH_FIRST_PAGE_SIZE,
        offset: 0,
    };
    const early = earlyFirstSearchParams("?q=nurse&country=CA&work=remote", false)!;
    assert.equal(searchParamsKey(early), searchParamsKey(expected));
    assert.equal(early.sort, "relevance");
    assert.equal(early.hideGhosts, true, "likely ghosts stay hidden by default");
    assert.equal(early.postedBucket, "90d", "a typed search's 90-day window is a real filter");
    assert.deepEqual(early.facets, { location_country: ["CA"], work_type: ["remote"] });
});

test("URL choices and the dismissed location default carry into the early request", () => {
    const p = earlyFirstSearchParams("?q=nurse&sort=newest&ghosts=show&posted=any", true)!;
    assert.equal(p.sort, "newest");
    assert.equal(p.hideGhosts, false);
    assert.equal(p.postedBucket, undefined);
    assert.equal(p.suppressLocationDefault, true);
    assert.equal(earlyFirstSearchParams("?q=nurse", false)!.suppressLocationDefault, undefined);
});

test("params keys ignore key order and undefined fields", () => {
    const a: JobSearchParams = { q: "nurse", limit: 20, offset: 0, sort: undefined, facets: { work_type: ["remote"] } };
    const b: JobSearchParams = { facets: { work_type: ["remote"] }, offset: 0, limit: 20, q: "nurse" };
    assert.equal(searchParamsKey(a), searchParamsKey(b));
    assert.notEqual(searchParamsKey(a), searchParamsKey({ ...b, limit: 60 }));
});

test("the pending result goes to the first matching request only", async () => {
    resetEarlyFirstSearchForTests();
    const params = earlyFirstSearchParams("?q=nurse", false)!;
    let calls = 0;
    startEarlyFirstSearch(params, async () => {
        calls += 1;
        return { hits: ["row"] };
    }, 1_000);
    assert.equal(calls, 1);
    assert.equal(takeEarlyFirstSearch({ ...params, limit: 1 }, 1_100), null, "a count probe is not the list");
    const taken = takeEarlyFirstSearch<{ hits: string[] }>({ ...params }, 1_200);
    assert.ok(taken, "the list's own first request takes it");
    assert.deepEqual(await taken, { hits: ["row"] });
    assert.equal(takeEarlyFirstSearch(params, 1_300), null, "a retry searches again");
});

test("an early result nobody took in time is dropped", () => {
    resetEarlyFirstSearchForTests();
    const params = earlyFirstSearchParams("?q=nurse", false)!;
    startEarlyFirstSearch(params, async () => ({}), 0);
    assert.equal(takeEarlyFirstSearch(params, EARLY_FIRST_SEARCH_TTL_MS + 1), null);
    assert.equal(takeEarlyFirstSearch(params, 0), null);
});

test("a failed early request never surfaces as an unhandled rejection", async () => {
    resetEarlyFirstSearchForTests();
    const params = earlyFirstSearchParams("?q=nurse", false)!;
    startEarlyFirstSearch(params, () => Promise.reject(new Error("offline")), 0);
    await new Promise((r) => setTimeout(r, 0));
    await assert.rejects(takeEarlyFirstSearch(params, 1)!, /offline/);
});

test("JobsContent takes the early result and shares its page size", () => {
    const page = readFileSync(path.join(ROOT, "src/app/jobs/JobsContent.tsx"), "utf8");
    assert.match(page, new RegExp(`const PAGE = ${SEARCH_FIRST_PAGE_SIZE};`), "same first-page size as the early request");
    assert.match(page, /takeEarlyFirstSearch<JobsSearchActionResult>\(params\) \?\? searchJobsActionRaw\(params\)/);
    // Both send the search the same way: over fetch, through search-client.ts.
    assert.match(page, /import \{ searchJobs as searchJobsActionRaw \} from "@\/lib\/jobs\/search-client";/);
    const gate = readFileSync(path.join(ROOT, "src/app/jobs/JobsRouteGate.tsx"), "utf8");
    assert.match(gate, /import \{ searchJobs \} from "@\/lib\/jobs\/search-client";/);
    assert.match(gate, /startEarlyFirstSearch\(params, searchJobs\)/);
});
