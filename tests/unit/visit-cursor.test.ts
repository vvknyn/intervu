import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

class FakeLocalStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    clear(): void {
        this.store.clear();
    }
}

const fakeLocalStorage = new FakeLocalStorage();
(globalThis as unknown as { localStorage: FakeLocalStorage }).localStorage = fakeLocalStorage;
// visit-cursor.ts (mirroring the original alert-cursor.ts) gates on
// `typeof window === "undefined"` to stay SSR-safe — a plain node:test
// process has no DOM, so without this stub every read/write would silently
// take the "server" branch and the localStorage path would never run.
(globalThis as unknown as { window: unknown }).window = globalThis;

import {
    bucketCursorToUtcDay,
    defaultVisitCursor,
    hasVisitCursor,
    readVisitCursor,
    writeVisitCursor,
} from "../../src/lib/jobs/visit-cursor";
import {
    defaultFollowAlertCursor,
    readFollowAlertCursor,
    writeFollowAlertCursor,
    FOLLOW_ALERT_CURSOR_KEY,
} from "../../src/lib/follows/alert-cursor";

beforeEach(() => {
    fakeLocalStorage.clear();
});

test("scope key isolation: writing 'board' never touches 'saved:x'", () => {
    writeVisitCursor("board", "2026-08-01T00:00:00.000Z");
    // "saved:x" was never written — it must still read as unset (the
    // default lookback), never the value just written for "board".
    assert.notEqual(readVisitCursor("saved:x"), "2026-08-01T00:00:00.000Z");
    assert.equal(readVisitCursor("board"), "2026-08-01T00:00:00.000Z");
});

test("hasVisitCursor: a written scope reads true", () => {
    writeVisitCursor("board", "2026-08-01T00:00:00.000Z");
    assert.equal(hasVisitCursor("board"), true);
});

test("hasVisitCursor: a different, untouched scope reads false", () => {
    writeVisitCursor("board", "2026-08-01T00:00:00.000Z");
    // "saved:x" was never written — `readVisitCursor` would still hand back
    // a fabricated default lookback for it, but `hasVisitCursor` must say
    // false: it exists to tell "never visited" apart from "visited a while
    // ago", which the default-lookback fallback alone cannot.
    assert.equal(hasVisitCursor("saved:x"), false);
});

test("follows scope reads/writes the legacy 'intervu.follows.alertCursor' key verbatim", () => {
    writeVisitCursor("follows", "2026-08-02T00:00:00.000Z");
    assert.equal(fakeLocalStorage.getItem(FOLLOW_ALERT_CURSOR_KEY), "2026-08-02T00:00:00.000Z");
    assert.equal(readFollowAlertCursor(), "2026-08-02T00:00:00.000Z");

    // And the reverse: writing through the legacy alert-cursor API lands in
    // the same key visit-cursor's "follows" scope reads.
    writeFollowAlertCursor("2026-08-03T00:00:00.000Z");
    assert.equal(readVisitCursor("follows"), "2026-08-03T00:00:00.000Z");
});

test("an invalid stored value falls back to the default lookback, not a parse error", () => {
    fakeLocalStorage.setItem("intervu.visitCursor.board", "not-a-date");
    const before = Date.now();
    const resultMs = Date.parse(readVisitCursor("board"));
    const after = Date.now();
    const lookback = 7 * 86_400_000;
    assert.ok(
        resultMs >= before - lookback && resultMs <= after - lookback,
        `expected ~7 days before now, got ${new Date(resultMs).toISOString()}`,
    );
});

test("default lookback math: 7 days back from a fixed clock", () => {
    const now = Date.parse("2026-08-08T12:00:00.000Z");
    assert.equal(defaultVisitCursor(now), "2026-08-01T12:00:00.000Z");
    assert.equal(defaultFollowAlertCursor(now), "2026-08-01T12:00:00.000Z");
});

test("defaultVisitCursor accepts a per-scope lookback override", () => {
    const now = Date.parse("2026-08-08T00:00:00.000Z");
    const oneDay = 86_400_000;
    assert.equal(defaultVisitCursor(now, oneDay), "2026-08-07T00:00:00.000Z");
});

test("saved:<id> scoping: two different saved-search ids never collide", () => {
    writeVisitCursor("saved:alpha", "2026-08-01T00:00:00.000Z");
    writeVisitCursor("saved:beta", "2026-08-05T00:00:00.000Z");
    assert.equal(readVisitCursor("saved:alpha"), "2026-08-01T00:00:00.000Z");
    assert.equal(readVisitCursor("saved:beta"), "2026-08-05T00:00:00.000Z");
});

test("bucketCursorToUtcDay: mid-day timestamps floor to UTC midnight", () => {
    assert.equal(bucketCursorToUtcDay("2026-08-08T14:32:09.123Z"), "2026-08-08T00:00:00.000Z");
});

test("bucketCursorToUtcDay: an exact UTC midnight is its own fixed point", () => {
    assert.equal(bucketCursorToUtcDay("2026-08-08T00:00:00.000Z"), "2026-08-08T00:00:00.000Z");
});

test("bucketCursorToUtcDay: an invalid cursor floors to today rather than throwing", () => {
    const todayFloor = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000).toISOString();
    assert.equal(bucketCursorToUtcDay("not-a-date"), todayFloor);
});
