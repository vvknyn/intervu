import assert from "node:assert/strict";
import { test } from "node:test";
import { countAppliedSince } from "../../src/lib/pursuits/tracker-display";
import type { Pursuit } from "../../src/lib/pursuits/types";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-08-08T00:00:00.000Z");
const SINCE = NOW - 7 * DAY_MS;

function pursuit(overrides: Partial<Pursuit> = {}): Pursuit {
    return {
        id: "p1",
        user_id: "u1",
        company_name: "Acme",
        position: "Engineer",
        status: "applied",
        created_at: new Date(NOW).toISOString(),
        updated_at: new Date(NOW).toISOString(),
        ...overrides,
    };
}

test("none applied returns zero", () => {
    const list = [
        pursuit({ id: "p1", status: "interested" }),
        pursuit({ id: "p2", status: "applied", applied_at: new Date(NOW - 20 * DAY_MS).toISOString() }),
    ];
    assert.equal(countAppliedSince(list, SINCE), 0);
});

test("mixed timestamps — only applied_at within the window counts", () => {
    const list = [
        pursuit({ id: "p1", applied_at: new Date(NOW - 1 * DAY_MS).toISOString() }), // in window
        pursuit({ id: "p2", applied_at: new Date(NOW - 6 * DAY_MS).toISOString() }), // in window
        pursuit({ id: "p3", applied_at: new Date(NOW - 10 * DAY_MS).toISOString() }), // outside window
    ];
    assert.equal(countAppliedSince(list, SINCE), 2);
});

test("missing applied_at on some rows never counts or crashes — the class case", () => {
    const list = [
        pursuit({ id: "p1", applied_at: new Date(NOW - 1 * DAY_MS).toISOString() }),
        pursuit({ id: "p2", applied_at: undefined }),
        pursuit({ id: "p3", status: "interested", applied_at: undefined }),
    ];
    assert.doesNotThrow(() => countAppliedSince(list, SINCE));
    assert.equal(countAppliedSince(list, SINCE), 1);
});

test("empty list returns zero", () => {
    assert.equal(countAppliedSince([], SINCE), 0);
});
