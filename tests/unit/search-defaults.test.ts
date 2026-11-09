import test from "node:test";
import assert from "node:assert/strict";
import { PRISTINE_FILTER_STATE } from "@/components/jobs/FilterPanel";
import { buildJobSearchPayload } from "@/lib/jobs/search-payload";
import { SEARCH_DEFAULTS, defaultedFields, restoreDefaults, stripDefaulted } from "@/lib/jobs/search-defaults";
import { appliedPostedBucket } from "@/components/jobs/FilterPanel";
import { postedChipLabel } from "@/components/jobs/FilterChipsRow";
import { broadenRungs } from "@/lib/jobs/broaden";
import { DEFAULT_URL_STATE } from "@/lib/jobs/url-state";
import { applyIntent } from "@/lib/jobs/llm-understanding/intent-to-params";
import { EMPTY_INTENT, type JobSearchIntent } from "@/lib/jobs/llm-understanding/schema";
import type { JobSearchParams } from "@/lib/jobs/types";

const thisWeek: JobSearchIntent = { ...EMPTY_INTENT, posted_within_days: 7 };
/** The stage order searchJobs runs: strip defaults, understand, put back what nothing set. */
const understand = (raw: JobSearchParams, intent: JobSearchIntent = thisWeek) => restoreDefaults(applyIntent(stripDefaulted(raw), intent), raw);

test("the client sends the fresh-visit 90d as defaulted, and 'posted this week' then applies", () => {
    const raw = buildJobSearchPayload(PRISTINE_FILTER_STATE, "pm posted this week", null, true);
    assert.equal(raw.postedBucket, "90d");
    assert.deepEqual(raw.defaultedFields, ["postedBucket"]);
    assert.equal(understand(raw).postedBucket, "7d");
});

test("an explicitly chosen 90d is a choice: not defaulted, not overridden", () => {
    const raw = buildJobSearchPayload({ ...PRISTINE_FILTER_STATE, postedExplicit: true }, "pm posted this week", null, true);
    assert.equal(raw.defaultedFields, undefined);
    assert.equal(understand(raw).postedBucket, "90d");
});

test("a plain browse keeps the default; an explicit 'any date' stays unfiltered", () => {
    const raw = buildJobSearchPayload(PRISTINE_FILTER_STATE, "pm", null, true);
    assert.equal(understand(raw, EMPTY_INTENT).postedBucket, SEARCH_DEFAULTS.postedBucket);
    const any = buildJobSearchPayload({ ...PRISTINE_FILTER_STATE, postedBucket: undefined, postedExplicit: true }, "pm", null, true);
    assert.equal(understand(any, EMPTY_INTENT).postedBucket, undefined);
});

test("a window the corpus cannot back is never marked defaulted", () => {
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "pm", null, false).defaultedFields, undefined);
});

test("only DEFAULTED fields are stripped: other chosen fields survive (class, not postedBucket)", () => {
    const raw: JobSearchParams = { q: "x", postedBucket: "90d", salaryMin: 100, defaultedFields: defaultedFields(PRISTINE_FILTER_STATE) };
    assert.deepEqual(stripDefaulted(raw), { q: "x", salaryMin: 100, defaultedFields: ["postedBucket"] });
    assert.equal(understand(raw, { ...thisWeek, min_salary: { amount: 200, currency: null, period: null } as never }).salaryMin, 100);
});

test("a chosen employer lists all its roles: the untouched date window yields, a window the searcher picks applies", () => {
    // Release 76's live check: the "Bank of America" pick read "Nothing matches these filters", its one role being
    // older than the 90-day window nobody chose.
    const picked = { ...PRISTINE_FILTER_STATE, companyDomain: "bofa.example" };
    for (const q of ["", "teller"]) {
        const raw = buildJobSearchPayload(picked, q, null, true);
        assert.equal(raw.postedBucket, undefined, q);
        assert.equal(raw.defaultedFields, undefined, "nothing for the server to put back");
        assert.equal(understand(raw, EMPTY_INTENT).postedBucket, undefined);
    }
    // Every surface that says which window is on agrees: none.
    assert.equal(appliedPostedBucket(picked), undefined);
    assert.equal(postedChipLabel(picked), null);
    assert.equal(
        broadenRungs({ ...DEFAULT_URL_STATE, companyDomain: "bofa.example" }).some((r) => r.id === "any_date"),
        false,
        "no 'Any date' rung for a window that is not on",
    );
    // A window the searcher picks is a choice, and stays.
    const chose90 = buildJobSearchPayload({ ...picked, postedExplicit: true }, "", null, true);
    assert.equal(chose90.postedBucket, "90d");
    assert.equal(buildJobSearchPayload({ ...picked, postedBucket: "7d", postedExplicit: true }, "", null, true).postedBucket, "7d");
    // No employer chosen: the default stands, as before.
    assert.equal(appliedPostedBucket(PRISTINE_FILTER_STATE), SEARCH_DEFAULTS.postedBucket);
    assert.equal(appliedPostedBucket({ ...PRISTINE_FILTER_STATE, companyDomain: "  " }), SEARCH_DEFAULTS.postedBucket);
});
