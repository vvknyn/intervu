import assert from "node:assert/strict";
import { test } from "node:test";
import { daysSinceUpdate, isStalePursuit, STALE_APPLICATION_THRESHOLD_DAYS } from "../../src/lib/pursuits/tracker-display";
import type { Pursuit } from "../../src/lib/pursuits/types";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-08-08T00:00:00.000Z");

function pursuit(overrides: Partial<Pursuit> = {}): Pursuit {
    return {
        id: "p1",
        user_id: "u1",
        company_name: "Acme",
        position: "Engineer",
        status: "applied",
        created_at: new Date(NOW - 30 * DAY_MS).toISOString(),
        updated_at: new Date(NOW - 30 * DAY_MS).toISOString(),
        ...overrides,
    };
}

test("stale applied pursuit (no update well past threshold)", () => {
    const p = pursuit({ status: "applied", updated_at: new Date(NOW - 20 * DAY_MS).toISOString() });
    assert.equal(isStalePursuit(p, NOW), true);
});

test("fresh applied pursuit (updated recently) is not stale", () => {
    const p = pursuit({ status: "applied", updated_at: new Date(NOW - 2 * DAY_MS).toISOString() });
    assert.equal(isStalePursuit(p, NOW), false);
});

test("stale-but-interviewing is false — the class case: only `applied` means waiting on them", () => {
    const p = pursuit({ status: "interviewing", updated_at: new Date(NOW - 30 * DAY_MS).toISOString() });
    assert.equal(isStalePursuit(p, NOW), false);
});

test("every non-applied stage is exempt regardless of staleness", () => {
    const stages: Pursuit["status"][] = ["interested", "resume_ready", "interviewing", "offer", "rejected", "withdrawn"];
    for (const status of stages) {
        const p = pursuit({ status, updated_at: new Date(NOW - 90 * DAY_MS).toISOString() });
        assert.equal(isStalePursuit(p, NOW), false, `${status} should never be flagged stale`);
    }
});

test("boundary: exactly the threshold counts as stale, one day under does not", () => {
    const atThreshold = pursuit({
        status: "applied",
        updated_at: new Date(NOW - STALE_APPLICATION_THRESHOLD_DAYS * DAY_MS).toISOString(),
    });
    assert.equal(isStalePursuit(atThreshold, NOW), true);

    const underThreshold = pursuit({
        status: "applied",
        updated_at: new Date(NOW - (STALE_APPLICATION_THRESHOLD_DAYS - 1) * DAY_MS).toISOString(),
    });
    assert.equal(isStalePursuit(underThreshold, NOW), false);
});

test("daysSinceUpdate backs the same clock the boolean gates on", () => {
    const p = pursuit({ updated_at: new Date(NOW - 16 * DAY_MS).toISOString() });
    assert.equal(daysSinceUpdate(p, NOW), 16);
});
