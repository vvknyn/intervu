import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFactChips, ghostCheckedText } from "../../src/components/jobs/job-detail-facts";
import type { PublicJob } from "../../src/lib/jobs/types";

const job = (over: Partial<PublicJob>): PublicJob =>
    ({
        work_type: "unknown",
        employment_type: "unknown",
        experience_level: "unknown",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        ...over,
    }) as PublicJob;

/* ------------------------------ buildFactChips ------------------------------ */

test("buildFactChips: full data renders every chip in order", () => {
    const chips = buildFactChips(
        job({
            work_type: "remote",
            employment_type: "full_time",
            experience_level: "senior",
            salary_min: 120_000,
            salary_max: 150_000,
            salary_currency: "USD",
            salary_period: "year",
        }),
        "3d ago",
        "10d ago",
    );
    assert.deepEqual(chips, [
        { kind: "work_type", label: "Remote" },
        { kind: "employment_type", label: "Full Time" },
        { kind: "experience_level", label: "Senior" },
        { kind: "salary", label: "USD 120k–150k/yr" },
        { kind: "posted", label: "Posted 3d ago" },
        { kind: "first_seen", label: "First seen 10d ago" },
    ]);
});

test("buildFactChips: missing fields render no chips at all", () => {
    assert.deepEqual(buildFactChips(job({}), null, null), []);
});

test("buildFactChips: partial data only renders chips with real data — no salary, no dates", () => {
    const chips = buildFactChips(job({ work_type: "hybrid", experience_level: "mid" }), null, null);
    assert.deepEqual(chips, [
        { kind: "work_type", label: "Hybrid" },
        { kind: "experience_level", label: "Mid" },
    ]);
});

test("buildFactChips: posted known but first-seen unknown renders only the posted chip", () => {
    const chips = buildFactChips(job({}), "1d ago", null);
    assert.deepEqual(chips, [{ kind: "posted", label: "Posted 1d ago" }]);
});

/* ------------------------------ ghostCheckedText ----------------------------- */

const NOW = Date.parse("2026-08-01T12:00:00Z");

test("ghostCheckedText: a parseable updated_at reads as a relative check time", () => {
    const updatedAt = new Date(NOW - 3 * 3_600_000).toISOString();
    assert.equal(ghostCheckedText(updatedAt, NOW), "Checked 3h ago");
});

test("ghostCheckedText: null updated_at never fabricates a time", () => {
    assert.equal(ghostCheckedText(null, NOW), "Check time unavailable");
});

test("ghostCheckedText: an unparseable updated_at never fabricates a time", () => {
    assert.equal(ghostCheckedText("not-a-date", NOW), "Check time unavailable");
});
