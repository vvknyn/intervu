import { test } from "node:test";
import assert from "node:assert/strict";

import { listNewSince } from "../../src/lib/jobs/list-new-since";

const NOW = Date.parse("2026-10-21T15:00:00");
const DAY = 86_400_000;
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();

const fresh = (id: string) => ({ id, posted_at: iso(DAY), first_seen_at: iso(DAY) });
const old = (id: string) => ({ id, posted_at: iso(20 * DAY), first_seen_at: iso(20 * DAY) });
const THREE_DAYS_AGO = NOW - 3 * DAY;

test("a first visit says nothing, however many roles are fresh", () => {
    assert.equal(listNewSince({ rows: [fresh("a"), fresh("b")], seenBefore: new Set(), sinceMs: null, nowMs: NOW }), null);
});

test("a device that has kept no list says nothing", () => {
    assert.equal(listNewSince({ rows: [fresh("a")], seenBefore: null, sinceMs: THREE_DAYS_AGO, nowMs: NOW }), null);
});

test("counts the fresh roles this device had not listed, and names the day it was last here", () => {
    const result = listNewSince({
        rows: [fresh("new-1"), fresh("new-2"), fresh("listed-before"), old("old-unlisted")],
        seenBefore: new Set(["listed-before"]),
        sinceMs: THREE_DAYS_AGO,
        nowMs: NOW,
    });
    assert.equal(result?.count, 2);
    assert.match(result!.text, /^2 new since (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/);
});

test("a role that is only further down a list it was always in is not new", () => {
    assert.equal(listNewSince({ rows: [old("a"), old("b")], seenBefore: new Set(["c"]), sinceMs: THREE_DAYS_AGO, nowMs: NOW }), null);
});

test("nothing new says nothing, not a zero", () => {
    assert.equal(listNewSince({ rows: [fresh("a")], seenBefore: new Set(["a"]), sinceMs: THREE_DAYS_AGO, nowMs: NOW }), null);
});

test("a role with no first-seen date carries no New mark, so it is not counted", () => {
    assert.equal(
        listNewSince({ rows: [{ id: "x", posted_at: iso(DAY), first_seen_at: null }], seenBefore: new Set(), sinceMs: THREE_DAYS_AGO, nowMs: NOW }),
        null,
    );
});

test("a return the same day says so", () => {
    const result = listNewSince({ rows: [fresh("a")], seenBefore: new Set(), sinceMs: NOW - 2 * 3_600_000, nowMs: NOW });
    assert.equal(result?.text, "1 new since you were here earlier today");
});

test("yesterday reads as yesterday", () => {
    const result = listNewSince({ rows: [fresh("a")], seenBefore: new Set(), sinceMs: NOW - DAY, nowMs: NOW });
    assert.equal(result?.text, "1 new since yesterday");
});
