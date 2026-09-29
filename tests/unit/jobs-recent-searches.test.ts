import { test } from "node:test";
import assert from "node:assert/strict";
import {
    rememberSearch,
    loadRecentSearches,
    saveRecentSearches,
    clearRecentSearches,
    RECENT_SEARCHES_KEY,
    resolveSearchSeeds,
    CURATED_SEARCH_SEEDS,
} from "../../src/lib/jobs/recent-searches";

/* ----------------------------- rememberSearch ----------------------------- */

test("rememberSearch prepends a new query", () => {
    assert.deepEqual(rememberSearch([], "backend engineer"), ["backend engineer"]);
});

test("rememberSearch trims whitespace before storing", () => {
    assert.deepEqual(rememberSearch([], "  backend engineer  "), ["backend engineer"]);
});

test("rememberSearch drops an empty/whitespace-only query, list unchanged", () => {
    assert.deepEqual(rememberSearch(["existing"], "   "), ["existing"]);
});

test("rememberSearch drops a single-character query, list unchanged", () => {
    assert.deepEqual(rememberSearch(["existing"], "a"), ["existing"]);
});

test("rememberSearch accepts a 2-character query", () => {
    assert.deepEqual(rememberSearch([], "pm"), ["pm"]);
});

test("rememberSearch dedupes case-insensitively, moving the match to the front under its new casing", () => {
    const list = ["Backend Engineer", "SRE", "PM"];
    assert.deepEqual(rememberSearch(list, "backend engineer"), ["backend engineer", "SRE", "PM"]);
});

test("rememberSearch caps at max (default 3), dropping the oldest", () => {
    assert.deepEqual(rememberSearch(["a1", "b2", "c3"], "d4"), ["d4", "a1", "b2"]);
});

test("rememberSearch respects a custom max", () => {
    assert.deepEqual(rememberSearch(["a1"], "b2", 1), ["b2"]);
});

test("rememberSearch does not mutate the input list", () => {
    const list = ["a1", "b2"];
    rememberSearch(list, "c3");
    assert.deepEqual(list, ["a1", "b2"]);
});

/* -------------------------- localStorage wrappers -------------------------- */

test("loadRecentSearches returns [] when localStorage is unavailable", () => {
    assert.deepEqual(loadRecentSearches(), []);
});

test("saveRecentSearches / clearRecentSearches are no-ops, not throws, without localStorage", () => {
    assert.doesNotThrow(() => saveRecentSearches(["x"]));
    assert.doesNotThrow(() => clearRecentSearches());
});

/** Minimal in-memory Storage stub — Node's test runner has no DOM/localStorage. */
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
        saveRecentSearches(["backend engineer", "pm"]);
        assert.deepEqual(loadRecentSearches(), ["backend engineer", "pm"]);
        clearRecentSearches();
        assert.deepEqual(loadRecentSearches(), []);
    });
});

test("loadRecentSearches degrades to [] on malformed JSON rather than throwing", () => {
    withFakeStorage(() => {
        localStorage.setItem(RECENT_SEARCHES_KEY, "{not json");
        assert.deepEqual(loadRecentSearches(), []);
    });
});

test("loadRecentSearches degrades to [] on a non-array value rather than throwing", () => {
    withFakeStorage(() => {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ not: "an array" }));
        assert.deepEqual(loadRecentSearches(), []);
    });
});

test("loadRecentSearches caps legacy over-long history at the store max (incumbent key held up to 10)", () => {
    withFakeStorage(() => {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(["q1", "q2", "q3", "q4", "q5"]));
        assert.deepEqual(loadRecentSearches(), ["q1", "q2", "q3"]);
    });
});

test("loadRecentSearches drops non-string entries from a mixed legacy array", () => {
    withFakeStorage(() => {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(["q1", 42, null, "q2"]));
        assert.deepEqual(loadRecentSearches(), ["q1", "q2"]);
    });
});

/* ------------------------- resolveSearchSeeds (SERP-ask) ------------------------- */

test("resolveSearchSeeds puts recent searches first, then backfills with curated", () => {
    const seeds = resolveSearchSeeds(["backend engineer"], ["product manager", "software engineer"]);
    assert.deepEqual(seeds, ["backend engineer", "product manager", "software engineer"]);
});

test("resolveSearchSeeds dedupes case-insensitively — a curated entry already in recent isn't repeated", () => {
    const seeds = resolveSearchSeeds(["Product Manager"], ["product manager", "software engineer"]);
    assert.deepEqual(seeds, ["Product Manager", "software engineer"]);
});

test("resolveSearchSeeds fills the curated list up to the target cap", () => {
    const curated = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    assert.deepEqual(resolveSearchSeeds([], curated, 8), curated.slice(0, 8));
});

test("resolveSearchSeeds with no recent searches falls back to curated alone, capped at ~8 by default", () => {
    assert.deepEqual(resolveSearchSeeds([]), CURATED_SEARCH_SEEDS);
    // afa39dca dropped the Canada preset, leaving 7 curated seeds — the cap is 8, not a count.
    assert.ok(resolveSearchSeeds([]).length <= 8);
});

test("resolveSearchSeeds drops empty/whitespace-only entries from either source", () => {
    const seeds = resolveSearchSeeds(["", "  ", "backend engineer"], ["product manager"]);
    assert.deepEqual(seeds, ["backend engineer", "product manager"]);
});

test("resolveSearchSeeds respects a smaller target cap across both sources combined", () => {
    const seeds = resolveSearchSeeds(["a", "b"], ["c", "d", "e"], 3);
    assert.deepEqual(seeds, ["a", "b", "c"]);
});

/* --- near-duplicate seeds (prod screenshot 2026-08-08: "customer success
 * manager" and "customer success managr" rendered as sibling chips) --- */

test("resolveSearchSeeds drops a one-character typo of a seed already shown, keeping the first (most recent) spelling", () => {
    const seeds = resolveSearchSeeds(
        ["customer success manager", "customer success managr"],
        ["product manager"],
    );
    assert.deepEqual(seeds, ["customer success manager", "product manager"]);
});

test("near-duplicate dedupe covers the class, not just that pair: a dropped char, a doubled char, a substitution and a plural all collapse", () => {
    assert.deepEqual(resolveSearchSeeds(["backend engineer", "backend enginer"], []), ["backend engineer"]);
    assert.deepEqual(resolveSearchSeeds(["backend engineer", "backend engineeer"], []), ["backend engineer"]);
    assert.deepEqual(resolveSearchSeeds(["backend engineer", "backend enginner"], []), ["backend engineer"]);
    assert.deepEqual(resolveSearchSeeds(["product manager", "product managers"], []), ["product manager"]);
});

test("two genuinely distinct searches both survive — including short ones a single character apart, where that character IS the distinction", () => {
    assert.deepEqual(resolveSearchSeeds(["product manager", "product designer"], []), [
        "product manager",
        "product designer",
    ]);
    assert.deepEqual(resolveSearchSeeds(["ai", "ui"], []), ["ai", "ui"]);
    assert.deepEqual(resolveSearchSeeds(["java", "lava"], []), ["java", "lava"]);
});

test("dedupe is case- and whitespace-insensitive, and the emitted seed is normalized (inner whitespace collapsed)", () => {
    assert.deepEqual(resolveSearchSeeds(["  Data   Scientist ", "data scientist"], []), ["Data Scientist"]);
});

test("order is preserved: recent searches stay in their given order, near-dupes never reorder the survivors", () => {
    const seeds = resolveSearchSeeds(
        ["data scientist", "marketing manager", "marketing managr", "sales engineer"],
        [],
    );
    assert.deepEqual(seeds, ["data scientist", "marketing manager", "sales engineer"]);
});
