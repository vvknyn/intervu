import { test } from "node:test";
import assert from "node:assert/strict";
import {
    addSavedSearch,
    hrefFromJobsUrlState,
    jobsUrlStateFromSavedHref,
    loadSavedSearches,
    removeSavedSearch,
    saveSavedSearches,
    SAVED_SEARCHES_KEY,
    stateForSavedSearch,
    suggestSavedSearchName,
    MAX_SAVED_SEARCHES,
} from "../../src/lib/jobs/saved-searches";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "../../src/lib/jobs/url-state";

test("stateForSavedSearch strips jobId", () => {
    const state = { ...DEFAULT_URL_STATE, q: "pm", jobId: "abc123" };
    assert.equal(stateForSavedSearch(state).jobId, null);
    assert.equal(stateForSavedSearch(state).q, "pm");
});

test("hrefFromJobsUrlState round-trips through parseJobsUrl", () => {
    const state = {
        ...DEFAULT_URL_STATE,
        q: "engineer",
        facets: { work_type: ["remote"] },
        sort: "salary" as const,
    };
    const href = hrefFromJobsUrlState(state);
    const parsed = jobsUrlStateFromSavedHref(href);
    assert.equal(parsed.q, "engineer");
    assert.deepEqual(parsed.facets.work_type, ["remote"]);
    assert.equal(parsed.sort, "salary");
    assert.equal(parsed.jobId, null);
});

test("suggestSavedSearchName prefers query text", () => {
    assert.equal(suggestSavedSearchName({ ...DEFAULT_URL_STATE, q: "product manager" }), "product manager");
    assert.equal(suggestSavedSearchName(DEFAULT_URL_STATE), "Saved search");
});

test("addSavedSearch prepends and dedupes by href", () => {
    const href = serializeJobsUrl({ ...DEFAULT_URL_STATE, q: "sre" });
    const list = addSavedSearch([], { name: "A", href }, MAX_SAVED_SEARCHES, () => "t1");
    assert.equal(list.length, 1);
    assert.equal(list[0]?.name, "A");
    const updated = addSavedSearch(list, { name: "B", href }, MAX_SAVED_SEARCHES, () => "t2");
    assert.equal(updated.length, 1);
    assert.equal(updated[0]?.name, "B");
});

test("addSavedSearch caps at max", () => {
    let list = addSavedSearch([], { name: "1", href: "?q=1" }, MAX_SAVED_SEARCHES, () => "t0");
    for (let i = 2; i <= MAX_SAVED_SEARCHES + 2; i++) {
        list = addSavedSearch(list, { name: String(i), href: `?q=${i}` }, MAX_SAVED_SEARCHES, () => `t${i}`);
    }
    assert.equal(list.length, MAX_SAVED_SEARCHES);
    assert.equal(list[0]?.href, `?q=${MAX_SAVED_SEARCHES + 2}`);
});

test("addSavedSearch rejects empty name or href", () => {
    const list = [{ id: "1", name: "x", href: "?q=a", createdAt: "t" }];
    assert.deepEqual(addSavedSearch(list, { name: "  ", href: "?q=b" }), list);
    assert.deepEqual(addSavedSearch(list, { name: "ok", href: "" }), list);
});

test("removeSavedSearch drops by id", () => {
    const list = [
        { id: "a", name: "A", href: "?q=a", createdAt: "t" },
        { id: "b", name: "B", href: "?q=b", createdAt: "t" },
    ];
    assert.deepEqual(removeSavedSearch(list, "a"), [list[1]]);
});

class FakeStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? (this.store.get(key) as string) : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
}

function withFakeStorage(run: () => void): void {
    const target = globalThis as unknown as { localStorage?: Storage };
    target.localStorage = new FakeStorage() as unknown as Storage;
    try {
        run();
    } finally {
        delete target.localStorage;
    }
}

test("save/load round-trips saved searches", () => {
    withFakeStorage(() => {
        const entry = { id: "1", name: "PM remote", href: "?q=pm", createdAt: "2026-01-01T00:00:00.000Z" };
        saveSavedSearches([entry]);
        assert.deepEqual(loadSavedSearches(), [entry]);
    });
});

test("loadSavedSearches degrades on malformed JSON", () => {
    withFakeStorage(() => {
        localStorage.setItem(SAVED_SEARCHES_KEY, "{bad");
        assert.deepEqual(loadSavedSearches(), []);
    });
});
