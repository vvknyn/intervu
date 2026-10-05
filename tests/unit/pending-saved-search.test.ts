import { test } from "node:test";
import assert from "node:assert/strict";
import {
    PENDING_SAVED_SEARCH_KEY,
    PENDING_SAVED_SEARCH_MAX_AGE_MS,
    stashPendingSavedSearch,
    takePendingSavedSearch,
} from "../../src/lib/jobs/pending-saved-search";

function memoryStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
    };
}

test("a search stashed at the sign-in card is taken once after sign-in", () => {
    const storage = memoryStorage();
    stashPendingSavedSearch(storage, { name: " Registered nurse ", href: "?q=registered+nurse&country=Canada" }, 1_000);
    assert.deepEqual(takePendingSavedSearch(storage, 2_000), { name: "Registered nurse", href: "?q=registered+nurse&country=Canada" });
    assert.equal(takePendingSavedSearch(storage, 2_000), null);
    assert.equal(storage.map.has(PENDING_SAVED_SEARCH_KEY), false);
});

test("a stale, future or malformed stash is dropped, and cleared all the same", () => {
    const storage = memoryStorage();
    stashPendingSavedSearch(storage, { name: "Teacher", href: "?q=teacher" }, 0);
    assert.equal(takePendingSavedSearch(storage, PENDING_SAVED_SEARCH_MAX_AGE_MS + 1), null);
    assert.equal(storage.map.has(PENDING_SAVED_SEARCH_KEY), false);

    stashPendingSavedSearch(storage, { name: "Teacher", href: "?q=teacher" }, 5_000);
    assert.equal(takePendingSavedSearch(storage, 1_000), null);

    storage.setItem(PENDING_SAVED_SEARCH_KEY, "{not json");
    assert.equal(takePendingSavedSearch(storage, 1_000), null);
    assert.equal(storage.map.has(PENDING_SAVED_SEARCH_KEY), false);
});

test("an empty name or search is never stashed, and a throwing storage never throws", () => {
    const storage = memoryStorage();
    stashPendingSavedSearch(storage, { name: "  ", href: "?q=x" });
    stashPendingSavedSearch(storage, { name: "x", href: "" });
    assert.equal(storage.map.size, 0);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    assert.doesNotThrow(() => stashPendingSavedSearch(broken, { name: "x", href: "?q=x" }));
    assert.equal(takePendingSavedSearch(broken), null);
});
