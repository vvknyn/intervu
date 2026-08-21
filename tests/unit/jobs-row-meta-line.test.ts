import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildRowMetaLine,
    employmentTypeSegment,
    locationWithMode,
    type RowMetaSegment,
} from "../../src/lib/jobs/presentation";

const NO_FACTS = { salary: null, location: null, employmentType: null };

test("salary leads the line, emphasized, followed by location then employment type", () => {
    const segments = buildRowMetaLine(
        { salary: "$104k–152k", location: "Remote (US)", employmentType: "Contract" },
        "6d ago",
    );
    assert.deepEqual(segments, [
        { text: "$104k–152k", emphasis: true },
        { text: "Remote (US)", emphasis: false },
        { text: "Contract", emphasis: false },
    ] satisfies RowMetaSegment[]);
});

test("absence is silence — a missing segment is omitted, never a placeholder", () => {
    const segments = buildRowMetaLine(
        { salary: null, location: "Austin, TX", employmentType: null },
        "6d ago",
    );
    assert.deepEqual(segments, [{ text: "Austin, TX", emphasis: false }]);
    // No stray "pay undisclosed"/"Unknown" text anywhere in the line.
    assert.ok(!segments.some((s) => /undisclosed|unknown/i.test(s.text)));
});

test("posted-date fallback when nothing is known", () => {
    const segments = buildRowMetaLine(NO_FACTS, "6d ago");
    assert.deepEqual(segments, [{ text: "Posted 6d ago", emphasis: false }]);
});

test("no posted age either — renders nothing rather than a bare 'Posted'", () => {
    assert.deepEqual(buildRowMetaLine(NO_FACTS, null), []);
});

test("survivor case — only work type known renders just that, no separators", () => {
    const segments = buildRowMetaLine(
        { salary: null, location: null, employmentType: "Part Time" },
        "6d ago",
    );
    assert.deepEqual(segments, [{ text: "Part Time", emphasis: false }]);
});

test("employmentTypeSegment suppresses the default full-time value", () => {
    assert.equal(employmentTypeSegment("full_time"), null);
    assert.equal(employmentTypeSegment("unknown"), null);
    assert.equal(employmentTypeSegment(null), null);
    assert.equal(employmentTypeSegment("contract"), "Contract");
    assert.equal(employmentTypeSegment("part_time"), "Part Time");
});

test("locationWithMode appends onsite/hybrid but leaves remote alone", () => {
    assert.equal(locationWithMode("Edmonton, Alberta, Canada", "onsite"), "Edmonton, Alberta, Canada · Onsite");
    assert.equal(locationWithMode("Toronto, Ontario", "hybrid"), "Toronto, Ontario · Hybrid");
    assert.equal(locationWithMode("Remote (US)", "remote"), "Remote (US)");
    assert.equal(locationWithMode("Austin, TX", "unknown"), "Austin, TX");
});
