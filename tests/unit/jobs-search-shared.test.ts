/**
 * `sharedLiveSearch` (search-cache.ts): visitors running the same search share
 * one Meilisearch call, so a crowd costs the search box what one visitor does.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
    SEARCH_FRESH_MS,
    clearSearchCacheForTests,
    getDegradedServe,
    normalizeSearchCacheKey,
    setSearchFreshMsForTests,
    sharedLiveSearch,
} from "../../src/lib/jobs/search-cache";
import type { JobSearchResult } from "../../src/lib/jobs/types";

const result = (total: number): JobSearchResult => ({ hits: [], total, backend: "meilisearch", configured: true }) as JobSearchResult;

beforeEach(() => {
    clearSearchCacheForTests();
    setSearchFreshMsForTests(SEARCH_FRESH_MS);
});

test("searches already on their way are joined: ten identical searches make one call", async () => {
    let calls = 0;
    const run = () => {
        calls++;
        return new Promise<JobSearchResult>((resolve) => setTimeout(() => resolve(result(7)), 10));
    };
    const all = await Promise.all(Array.from({ length: 10 }, () => sharedLiveSearch({ q: "nurse" }, run)));
    assert.equal(calls, 1);
    assert.ok(all.every((r) => r.total === 7));
});

test("a live answer is reused inside the window and asked again after it", async () => {
    let calls = 0;
    const run = async () => result(++calls);
    const t0 = 1_000_000;
    assert.equal((await sharedLiveSearch({ q: "nurse" }, run, t0)).total, 1);
    assert.equal((await sharedLiveSearch({ q: " Nurse " }, run, t0 + SEARCH_FRESH_MS - 1)).total, 1, "same search, same answer");
    assert.equal((await sharedLiveSearch({ q: "nurse" }, run, Date.now() + SEARCH_FRESH_MS)).total, 2, "window passed: a new call");
});

test("different searches never share", async () => {
    let calls = 0;
    const run = async () => result(++calls);
    await sharedLiveSearch({ q: "nurse" }, run);
    await sharedLiveSearch({ q: "nurse", offset: 40 }, run);
    await sharedLiveSearch({ q: "nurse", yearsExperience: "3-5" }, run);
    await sharedLiveSearch({ q: "nurse", fitPhrases: ["Registered Nurse"] }, run);
    assert.equal(calls, 4);
});

test("years of experience and fit phrases are part of what makes two searches the same", () => {
    assert.notEqual(normalizeSearchCacheKey({ q: "nurse" }), normalizeSearchCacheKey({ q: "nurse", yearsExperience: "0-2" }));
    assert.notEqual(
        normalizeSearchCacheKey({ fitPhrases: ["Nurse", "RN"] }),
        normalizeSearchCacheKey({ fitPhrases: ["RN", "Nurse"] }),
        "phrase order is lane order",
    );
});

test("a failure is never reused, and a success becomes the outage fallback", async () => {
    let calls = 0;
    await assert.rejects(
        sharedLiveSearch({ q: "teacher" }, async () => {
            calls++;
            throw new Error("ECONNRESET");
        }),
    );
    assert.equal(getDegradedServe({ q: "teacher" }), null, "a failure teaches the cache nothing");
    const ok = await sharedLiveSearch({ q: "teacher" }, async () => {
        calls++;
        return result(3);
    });
    assert.equal(calls, 2);
    assert.equal(ok.total, 3);
    assert.equal(getDegradedServe({ q: "teacher" })?.result.total, 3);
});

test("with sharing off, every search calls", async () => {
    setSearchFreshMsForTests(0);
    let calls = 0;
    const run = async () => result(++calls);
    await sharedLiveSearch({ q: "nurse" }, run);
    await sharedLiveSearch({ q: "nurse" }, run);
    assert.equal(calls, 2);
});
