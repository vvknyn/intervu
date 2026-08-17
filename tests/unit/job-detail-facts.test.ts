import { test } from "node:test";
import assert from "node:assert/strict";
import { alsoInLabel, assessedGhostSignals, buildFactChips, deriveExposureBadges, deriveGhostSignals, ghostCheckedText } from "../../src/components/jobs/job-detail-facts";
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

test("deriveGhostSignals: a fresh, non-relisted, substantial, salaried posting — reposts is honest absence, not a fabricated favorable", () => {
    const signals = deriveGhostSignals(
        job({ description: "x".repeat(250), salary_min: 120_000, salary_currency: "USD", salary_period: "year" }),
        freshness({ kind: "fresh", firstSeenMs: NOW - 2 * 86_400_000 }),
        3,
        NOW,
    );
    // ITEM T (2026-08-15): reposts can never come back favorable — there is no
    // close/reopen data source in the corpus, so "no repost history" would
    // overclaim evidence this app doesn't have (see deriveGhostSignals' doc).
    // It is `unknown`, NOT `unfavorable` (2026-08-16): a check that cannot run
    // must not score against the posting.
    assert.deepEqual(
        signals.map((s) => s.status),
        ["favorable", "unknown", "favorable", "favorable"],
    );
    assert.deepEqual(
        signals.map((s) => s.kind),
        ["freshness", "reposts", "description", "pay"],
    );
    assert.match(signals[0]!.text, /within the last 7 days/);
    assert.match(signals[1]!.text, /not tracked yet/);
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
    // Age and a thin description are real findings against the posting;
    // an untracked repost history and an undisclosed salary are absences.
    assert.deepEqual(
        signals.map((s) => s.status),
        ["unfavorable", "unknown", "unfavorable", "unknown"],
    );
    // ITEM T correction (2026-08-15): a relist is a freshness-integrity fact,
    // not a repost — the "refreshed" text lives on the freshness row now;
    // the reposts row stays its own, unaffected, neutral-absence self.
    assert.match(signals[0]!.text, /posted date refreshed since/);
    assert.match(signals[1]!.text, /not tracked yet/);
    assert.match(signals[2]!.text, /thin/);
    assert.match(signals[3]!.text, /not disclosed/);
});

test("deriveGhostSignals: reposts is UNCHANGED by relist state — same neutral text whether relisted or not", () => {
    const notRelisted = deriveGhostSignals(job({ description: null }), freshness({ kind: "fresh", firstSeenMs: NOW - 86_400_000 }), 0, NOW);
    const relisted = deriveGhostSignals(job({ description: null }), freshness({ kind: "relisted", firstSeenMs: NOW - 40 * 86_400_000 }), 0, NOW);
    const repostsOf = (signals: ReturnType<typeof deriveGhostSignals>) => signals.find((s) => s.kind === "reposts")!;
    assert.equal(repostsOf(notRelisted).text, repostsOf(relisted).text);
    assert.equal(repostsOf(notRelisted).status, repostsOf(relisted).status);
});

test("deriveGhostSignals: no first_seen at all omits BOTH freshness signals — never guesses", () => {
    const signals = deriveGhostSignals(job({ description: null }), freshness({}), 0, NOW);
    // No description either, so only the always-present salary signal remains.
    assert.equal(signals.length, 1);
    assert.equal(signals[0]!.kind, "pay");
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

/* --------------------------- deriveExposureBadges ---------------------------- */
/* S4 — dark launch: is_indexed_google/is_indexed_linkedin + their
 * *_indexed_at pairs are being added upstream and are absent on every doc
 * today. Positive-only, never a fabricated/negative state — see the
 * function's doc comment. */

test("deriveExposureBadges: absent fields (today's live corpus, the dark-launch case) render no badges", () => {
    assert.deepEqual(deriveExposureBadges(job({}), NOW), []);
});

test("deriveExposureBadges: false values never render a badge — positive-only, no negative state", () => {
    assert.deepEqual(
        deriveExposureBadges(
            job({
                is_indexed_google: false,
                google_indexed_at: new Date(NOW).toISOString(),
                is_indexed_linkedin: false,
                linkedin_indexed_at: new Date(NOW).toISOString(),
            }),
            NOW,
        ),
        [],
    );
});

test("deriveExposureBadges: true but no paired timestamp still renders nothing — a check with no known date isn't a fact to claim", () => {
    assert.deepEqual(deriveExposureBadges(job({ is_indexed_google: true, is_indexed_linkedin: true }), NOW), []);
});

test("deriveExposureBadges: both true with timestamps render both badges, each with its own checked time", () => {
    const badges = deriveExposureBadges(
        job({
            is_indexed_google: true,
            google_indexed_at: new Date(NOW - 3 * 3_600_000).toISOString(),
            is_indexed_linkedin: true,
            linkedin_indexed_at: new Date(NOW - 2 * 86_400_000).toISOString(),
        }),
        NOW,
    );
    assert.deepEqual(badges, [
        { label: "Seen on Google", checkedText: "Checked 3h ago" },
        { label: "On LinkedIn", checkedText: "Checked 2d ago" },
    ]);
});

test("deriveExposureBadges: Google true, LinkedIn absent — only the corroborated one renders", () => {
    const badges = deriveExposureBadges(
        job({ is_indexed_google: true, google_indexed_at: new Date(NOW - 3_600_000).toISOString() }),
        NOW,
    );
    assert.deepEqual(badges, [{ label: "Seen on Google", checkedText: "Checked 1h ago" }]);
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

/* --------------------- assessed vs unmeasured signals ---------------------- */

// Regression, reported live 2026-08-16 with a screenshot: an ordinary
// Globaltechmarkets posting showed "1/4 favorable" — a scary-looking score
// whose three non-favorable rows were an untracked repost history (no data
// source exists), an undisclosed salary, and its age. Two of those three were
// absences of data being counted as failed checks.
test("assessedGhostSignals: unmeasured signals leave the denominator — an absence is not a failure", () => {
    const signals = deriveGhostSignals(
        job({ description: "x".repeat(400), salary_min: null, salary_max: null }),
        freshness({ kind: null, firstSeenMs: NOW - 13 * 86_400_000 }),
        4,
        NOW,
    );
    assert.deepEqual(
        signals.map((s) => s.status),
        ["unfavorable", "unknown", "favorable", "unknown"],
    );

    const assessed = assessedGhostSignals(signals);
    const favorable = assessed.filter((s) => s.status === "favorable").length;

    // What the panel renders: "1/2 favorable · 2 not tracked", never "1/4".
    assert.equal(assessed.length, 2);
    assert.equal(favorable, 1);
    assert.equal(signals.length - assessed.length, 2);
});

// The unknowns are still SHOWN — this fix removes them from the score, not
// from the ledger. Hiding them would trade one dishonesty for another.
test("assessedGhostSignals: filters a copy — every signal is still rendered", () => {
    const signals = deriveGhostSignals(
        job({ description: null, salary_min: null }),
        freshness({ kind: "fresh", firstSeenMs: NOW - 86_400_000 }),
        0,
        NOW,
    );
    assert.equal(signals.length, 3);
    assert.equal(assessedGhostSignals(signals).length, 1);
});
