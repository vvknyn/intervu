import { test } from "node:test";
import assert from "node:assert/strict";
import { alsoInLabel, buildFactChips, deriveGhostSignals, ghostCheckedText } from "../../src/components/jobs/job-detail-facts";
import type { PostingFreshness } from "../../src/lib/jobs/posting-freshness";
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

/* ---------------------------- deriveGhostSignals ---------------------------- */

const freshness = (over: Partial<PostingFreshness>): PostingFreshness => ({
    kind: null,
    firstSeenMs: null,
    postedMs: null,
    ...over,
});

test("deriveGhostSignals: a fresh, non-relisted, substantial, salaried posting is all-positive", () => {
    const signals = deriveGhostSignals(
        job({ description: "x".repeat(250), salary_min: 120_000, salary_currency: "USD", salary_period: "year" }),
        freshness({ kind: "fresh", firstSeenMs: NOW - 2 * 86_400_000 }),
        3,
        NOW,
    );
    assert.deepEqual(
        signals.map((s) => s.positive),
        [true, true, true, true],
    );
    assert.match(signals[0]!.text, /within the last 7 days/);
    assert.match(signals[1]!.text, /no repost history/);
    assert.match(signals[2]!.text, /real substance/);
    assert.match(signals[3]!.text, /salary disclosed/);
});

test("deriveGhostSignals: a relisted, thin, unsalaried posting reports each honestly — no fabrication", () => {
    const signals = deriveGhostSignals(
        job({ description: "short blurb", salary_min: null, salary_max: null }),
        freshness({ kind: "relisted", firstSeenMs: NOW - 40 * 86_400_000 }),
        1,
        NOW,
    );
    assert.deepEqual(
        signals.map((s) => s.positive),
        [false, false, false, false],
    );
    assert.match(signals[1]!.text, /relisted from an earlier posting/);
    assert.match(signals[2]!.text, /thin/);
    assert.match(signals[3]!.text, /not disclosed/);
});

test("deriveGhostSignals: no first_seen at all omits BOTH freshness signals — never guesses", () => {
    const signals = deriveGhostSignals(job({ description: null }), freshness({}), 0, NOW);
    // No description either, so only the always-present salary signal remains.
    assert.equal(signals.length, 1);
    assert.match(signals[0]!.text, /not disclosed/);
});

test("deriveGhostSignals: no description at all omits the substance signal instead of calling it thin", () => {
    const signals = deriveGhostSignals(
        job({ description: null }),
        freshness({ kind: "fresh", firstSeenMs: NOW - 86_400_000 }),
        0,
        NOW,
    );
    assert.ok(!signals.some((s) => /\bsubstance\b|\bthin\b/.test(s.text)));
});

/* ------------------------------- alsoInLabel -------------------------------- */

test("alsoInLabel: no variants renders no chip", () => {
    assert.equal(alsoInLabel(job({ location_city: "Noida" }), []), null);
});

test("alsoInLabel: distinct-place variants join, capped at 3 with a '+N more' tail", () => {
    const here = job({ location_city: "Noida" });
    const variants = ["Redmond", "Dublin", "London", "Toronto"].map((city) => job({ location_city: city }));
    assert.equal(alsoInLabel(here, variants), "Redmond · Dublin · London +1 more");
});

test("alsoInLabel: a variant at the SAME place as the primary is excluded, not double-counted", () => {
    const here = job({ location_city: "Noida" });
    const variants = [job({ location_city: "Noida" }), job({ location_city: "Redmond" })];
    assert.equal(alsoInLabel(here, variants), "Redmond");
});

test("alsoInLabel: every variant sharing the primary's place renders no chip", () => {
    const here = job({ location_city: "Noida" });
    assert.equal(alsoInLabel(here, [job({ location_city: "Noida" })]), null);
});
