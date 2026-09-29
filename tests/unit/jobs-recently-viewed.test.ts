import { test } from "node:test";
import assert from "node:assert/strict";
import {
    rememberRecentlyViewed,
    loadRecentlyViewed,
    saveRecentlyViewed,
    clearRecentlyViewed,
    RECENTLY_VIEWED_KEY,
    type RecentlyViewedJob,
} from "../../src/lib/jobs/recently-viewed";

const sample = (id: string, title = "Engineer", company = "Acme"): RecentlyViewedJob => ({
    id,
    title,
    company,
});

test("rememberRecentlyViewed prepends a new entry", () => {
    assert.deepEqual(rememberRecentlyViewed([], sample("j1")), [sample("j1")]);
});

test("rememberRecentlyViewed dedupes by id, moving the match to the front", () => {
    const list = [sample("j1"), sample("j2"), sample("j3")];
    assert.deepEqual(rememberRecentlyViewed(list, sample("j2", "Staff Engineer", "Beta")), [
        sample("j2", "Staff Engineer", "Beta"),
        sample("j1"),
        sample("j3"),
    ]);
});

// #375 (babfff0d) raised the default cap 8 → 300 for the hide-viewed filter.
test("rememberRecentlyViewed caps at max, dropping the oldest", () => {
    const list = Array.from({ length: 8 }, (_, i) => sample(`j${i}`));
    const next = rememberRecentlyViewed(list, sample("j9"), 8);
    assert.equal(next.length, 8);
    assert.equal(next[0]?.id, "j9");
    assert.equal(next[7]?.id, "j6");
});

test("rememberRecentlyViewed respects a custom max", () => {
    assert.deepEqual(rememberRecentlyViewed([sample("j1")], sample("j2"), 1), [sample("j2")]);
});

test("rememberRecentlyViewed ignores an empty id", () => {
    assert.deepEqual(rememberRecentlyViewed([sample("j1")], sample("  ", "Title", "Co")), [sample("j1")]);
});

test("rememberRecentlyViewed trims fields and falls back for blank title/company", () => {
    assert.deepEqual(rememberRecentlyViewed([], sample("j1", "  PM  ", "  Stripe  ")), [
        { id: "j1", title: "PM", company: "Stripe" },
    ]);
    assert.deepEqual(rememberRecentlyViewed([], sample("j1", "  ", "  ")), [
        { id: "j1", title: "Untitled role", company: "Unknown company" },
    ]);
});

test("rememberRecentlyViewed does not mutate the input list", () => {
    const list = [sample("j1")];
    rememberRecentlyViewed(list, sample("j2"));
    assert.deepEqual(list, [sample("j1")]);
});

test("loadRecentlyViewed returns [] when localStorage is unavailable", () => {
    assert.deepEqual(loadRecentlyViewed(), []);
});

test("saveRecentlyViewed / clearRecentlyViewed are no-ops, not throws, without localStorage", () => {
    assert.doesNotThrow(() => saveRecentlyViewed([sample("j1")]));
    assert.doesNotThrow(() => clearRecentlyViewed());
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

test("save/load round-trips through localStorage", () => {
    withFakeStorage(() => {
        saveRecentlyViewed([sample("j1"), sample("j2")]);
        assert.deepEqual(loadRecentlyViewed(), [sample("j1"), sample("j2")]);
        clearRecentlyViewed();
        assert.deepEqual(loadRecentlyViewed(), []);
    });
});

test("loadRecentlyViewed degrades to [] on malformed JSON rather than throwing", () => {
    withFakeStorage(() => {
        localStorage.setItem(RECENTLY_VIEWED_KEY, "{not json");
        assert.deepEqual(loadRecentlyViewed(), []);
    });
});

test("loadRecentlyViewed drops invalid entries from a mixed legacy array", () => {
    withFakeStorage(() => {
        localStorage.setItem(
            RECENTLY_VIEWED_KEY,
            JSON.stringify([sample("j1"), { id: "j2" }, null, sample("j3")]),
        );
        assert.deepEqual(loadRecentlyViewed(), [sample("j1"), sample("j3")]);
    });
});

test("loadRecentlyViewed caps legacy over-long history at the store max", () => {
    withFakeStorage(() => {
        localStorage.setItem(
            RECENTLY_VIEWED_KEY,
            JSON.stringify(Array.from({ length: 302 }, (_, i) => sample(`j${i}`))),
        );
        assert.equal(loadRecentlyViewed().length, 300); // store max since #375 (babfff0d)
    });
});
