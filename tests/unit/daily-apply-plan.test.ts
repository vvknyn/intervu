import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEFAULT_DAILY_APPLY_GOAL,
    countAppliedToday,
    formatAppliedTodayChrome,
    remainingInDailyPlan,
    startOfLocalDay,
} from "../../src/lib/pursuits/daily-apply-plan";
import type { Pursuit } from "../../src/lib/pursuits/types";

const NOW = Date.parse("2026-09-24T15:00:00.000-04:00");

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

describe("daily apply plan", () => {
    it("defaults goal to 12", () => {
        assert.equal(DEFAULT_DAILY_APPLY_GOAL, 12);
    });

    it("counts only applied_at since local midnight", () => {
        const start = startOfLocalDay(NOW);
        const list = [
            pursuit({ id: "a", applied_at: new Date(start + 3_600_000).toISOString() }),
            pursuit({ id: "b", applied_at: new Date(start - 3_600_000).toISOString() }),
            pursuit({ id: "c", applied_at: undefined }),
        ];
        assert.equal(countAppliedToday(list, NOW), 1);
    });

    it("hides remaining when goal met", () => {
        assert.equal(formatAppliedTodayChrome(12), "Applied today 12");
        assert.equal(formatAppliedTodayChrome(15), "Applied today 15");
        assert.equal(
            formatAppliedTodayChrome(3),
            "Applied today 3 · 9 left in today’s plan",
        );
        assert.equal(remainingInDailyPlan(3), 9);
        assert.equal(remainingInDailyPlan(12), 0);
    });
});
