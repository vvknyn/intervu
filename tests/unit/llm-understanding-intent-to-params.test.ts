import { test } from "node:test";
import assert from "node:assert/strict";
import { applyIntent } from "../../src/lib/jobs/llm-understanding/intent-to-params";
import { EMPTY_INTENT, type JobSearchIntent } from "../../src/lib/jobs/llm-understanding/schema";
import { FACETABLE_KEYS, type JobSearchParams, type PlaceClause } from "../../src/lib/jobs/types";
import { unmatchedPlaceNote } from "../../src/lib/jobs/result-state";
import fixtures from "./fixtures/nl-search-intents.json";

const PLACE: PlaceClause = { any: [{ field: "location_city", value: "Toronto" }] };
const intent = (o: Partial<JobSearchIntent>): JobSearchIntent => ({ ...EMPTY_INTENT, ...o });
const mentions = (p: JobSearchParams) => p.unmatchedQueryMentions ?? [];

test("every fixture: only FACETABLE_KEYS written, and no non-null field is silently dropped", () => {
    for (const c of fixtures.cases) {
        const e = c.expect as JobSearchIntent;
        const hasLoc = Boolean(e.location.country || e.location.state || e.location.city);
        const out = applyIntent({ q: c.q }, e, hasLoc ? [PLACE] : []);
        const why = c.q;
        for (const k of Object.keys(out.facets ?? {})) assert.ok((FACETABLE_KEYS as readonly string[]).includes(k), `${why}: ${k}`);
        if (e.work_mode) assert.deepEqual(out.facets?.work_type, [e.work_mode], why);
        if (e.employment_type) assert.deepEqual(out.facets?.employment_type, [e.employment_type], why);
        if (e.experience_level) assert.deepEqual(out.facets?.experience_level, [e.experience_level], why);
        if (e.min_salary.amount) assert.equal(out.salaryMin, e.min_salary.amount, why);
        if (e.min_years !== null) assert.ok(out.yearsExperience, why);
        if (e.posted_within_days) {
            assert.ok(out.postedBucket || mentions(out).some((m) => m.includes(String(e.posted_within_days))), why);
        }
        if (hasLoc) assert.deepEqual(out.places, [PLACE], why);
        for (const u of e.unparsed) assert.ok(mentions(out).includes(u), `${why}: ${u}`);
        for (const x of e.exclude_titles) assert.ok(mentions(out).some((m) => m.includes(x)), `${why}: ${x}`);
        const q = (out.q ?? "").toLowerCase();
        for (const w of [...e.titles, ...e.terms]) {
            assert.ok(q.includes(w.toLowerCase()) || mentions(out).some((m) => m.toLowerCase().includes(w.toLowerCase())), `${why}: ${w}`);
        }
    }
});

test("explicit UI selections always win and are never overwritten", () => {
    const base: JobSearchParams = {
        q: "x",
        facets: { work_type: ["onsite"], employment_type: ["contract"], experience_level: ["entry"] },
        salaryMin: 50_000,
        postedBucket: "30d",
        yearsExperience: "0-2",
        places: [{ any: [{ field: "location_country", value: "CA" }] }],
    };
    const out = applyIntent(
        base,
        intent({
            work_mode: "remote", employment_type: "full_time", experience_level: "senior",
            min_salary: { amount: 200_000, currency: "USD" }, posted_within_days: 1, min_years: 9,
            location: { country: "US", state: null, city: null },
        }),
        [PLACE],
    );
    assert.deepEqual(out.facets, base.facets);
    assert.equal(out.salaryMin, 50_000);
    assert.equal(out.postedBucket, "30d");
    assert.equal(out.yearsExperience, "0-2");
    assert.deepEqual(out.places, base.places);
});

test("posted_within_days buckets: 1d 3d 7d 30d, beyond that is a mention not a filter", () => {
    const got = [1, 2, 3, 5, 7, 14, 30, 45].map((d) => {
        const o = applyIntent({}, intent({ posted_within_days: d }));
        return [o.postedBucket ?? null, mentions(o).length];
    });
    assert.deepEqual(got, [["1d", 0], ["3d", 0], ["3d", 0], ["7d", 0], ["7d", 0], ["30d", 0], ["30d", 0], [null, 1]]);
});

test("min_years buckets", () => {
    const got = [0, 2, 3, 5, 6, 10, 11, 20].map((y) => applyIntent({}, intent({ min_years: y })).yearsExperience);
    assert.deepEqual(got, ["0-2", "0-2", "3-5", "3-5", "6-10", "6-10", "11+", "11+"]);
});

test("location with no resolved place becomes a mention, never a guess", () => {
    const out = applyIntent({}, intent({ location: { country: null, state: null, city: "Atlantis" } }));
    assert.equal(out.places, undefined);
    assert.deepEqual(mentions(out), ["Atlantis"]);
});

test("several titles become a quoted OR list; their terms are mentioned, not mixed in", () => {
    const out = applyIntent({}, intent({ titles: ["a b", "c d"], terms: ["sql"] }));
    assert.equal(out.q, '"a b" OR "c d"');
    assert.deepEqual(mentions(out), ["sql"]);
});

test("one title plus terms is plain text", () => {
    assert.equal(applyIntent({}, intent({ titles: ["data analyst"], terms: ["sql"] })).q, "data analyst sql");
});

test("mentions append to existing ones without duplicates", () => {
    const out = applyIntent({ unmatchedQueryMentions: ["a"] }, intent({ unparsed: ["a", "b"] }));
    assert.deepEqual(mentions(out), ["a", "b"]);
});

test("one note covers place mentions and query mentions, in either combination", () => {
    assert.equal(unmatchedPlaceNote(undefined, undefined), null);
    assert.equal(unmatchedPlaceNote(["Atlantis"]), 'We have no roles in "Atlantis" — showing results without it.');
    assert.equal(unmatchedPlaceNote(undefined, ["a", "b"]), `We couldn't apply "a" and "b" — searched without them.`);
    assert.match(unmatchedPlaceNote(["Atlantis"], ["a"]) ?? "", /Atlantis.*couldn't apply "a"/);
});
