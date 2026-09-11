import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
    appliedPostedBucket,
    PRISTINE_FILTER_STATE,
    type FilterState,
} from "../../src/components/jobs/FilterPanel";
import { DATE_POSTED_SHORT_LABELS } from "../../src/components/jobs/SerpFilters";
import { nextPostedBucket, postedChipLabel } from "../../src/components/jobs/FilterChipsRow";
import { resolveBeyondWindow } from "../../src/lib/jobs/beyond-window";
import { searchResultLine } from "../../src/lib/jobs/presentation";

/**
 * The fresh-visit `postedBucket: "30d"` is the product default — a real
 * request filter, not a display-only value. Every surface that draws the
 * Posted control must agree it IS applied; only an explicit "Any date"
 * (`postedBucket: undefined`, `postedExplicit: true`) lifts it. Measured on
 * prod (velai.app, 2026-09-01), `?q=product+manager`: 14,682 roles labelled
 * "Any date" with the default silently dropped, vs 5,820 once the month
 * window is actually applied — the gap the default exists to hide.
 *
 * The rule has one home, `appliedPostedBucket` (FilterPanel.tsx). Every
 * consumer routes through it, and the structural guard below fails for any
 * FUTURE surface that draws the control without consulting it.
 */

const withPosted = (
    postedBucket: FilterState["postedBucket"],
    postedExplicit?: boolean,
): FilterState => ({ ...PRISTINE_FILTER_STATE, postedBucket, postedExplicit });

test("the unchosen 30d default IS the applied window — the fresh-visit product default", () => {
    assert.equal(appliedPostedBucket(PRISTINE_FILTER_STATE), "30d");
    assert.equal(appliedPostedBucket(withPosted("30d")), "30d");
});

test("the rail/facet-bar label reads 'Past month' for the applied fresh-visit default", () => {
    const applied = appliedPostedBucket(PRISTINE_FILTER_STATE);
    assert.equal(applied, "30d");
    assert.equal(DATE_POSTED_SHORT_LABELS[applied!], "Past month");
});

test("the SAME 30d value IS applied once the searcher picks it — explicitness is the only difference", () => {
    assert.equal(appliedPostedBucket(withPosted("30d", true)), "30d");
});

test("every non-default bucket is applied regardless of the explicit flag — proves the rule is 'unchosen default', not 'flag is set'", () => {
    // A bucket other than the pristine one cannot arrive without a choice,
    // so a missing flag (older bookmark, a caller that forgot it) must not
    // silently un-apply a real narrowing. Cases OTHER than the 30d one that
    // surfaced the bug.
    for (const b of ["1d", "3d", "7d", "older"] as const) {
        assert.equal(appliedPostedBucket(withPosted(b)), b, `implicit ${b}`);
        assert.equal(appliedPostedBucket(withPosted(b, true)), b, `explicit ${b}`);
    }
});

test("explicit 'Any' stays unapplied — clearing the window must not read back as the default", () => {
    assert.equal(appliedPostedBucket(withPosted(undefined, true)), undefined);
});

test("the mobile chip cycles from what is APPLIED, so a fresh visit's first tap widens to Any", () => {
    // Fresh visit: the pristine 30d IS applied (the product default), so the
    // next step in the cycle is the same widen-to-everything step a picked
    // 30d already takes (sibling below) — cycling is identical either way.
    assert.equal(nextPostedBucket(PRISTINE_FILTER_STATE), undefined);
    // Sibling: the cycle still advances normally from a chosen window, and
    // still wraps at the top.
    assert.equal(nextPostedBucket(withPosted("1d", true)), "3d");
    assert.equal(nextPostedBucket(withPosted("30d", true)), undefined);
});

test("the quick chip's face names the applied window, including the fresh-visit default", () => {
    assert.equal(postedChipLabel(PRISTINE_FILTER_STATE), "Last 30 days", "fresh visit now claims the applied default");
    assert.equal(postedChipLabel(withPosted("30d", true)), "Last 30 days", "the chosen 30d reads identically");
    assert.equal(postedChipLabel(withPosted("7d")), "Last week", "a non-default window is named");
    assert.equal(postedChipLabel(withPosted(undefined, true)), null, "explicit Any claims nothing");
});

// The two surfaces that SPEAK about the window rather than draw a control.
// Both were handed the raw bucket, and both said something untrue about an
// unfiltered result set.
const FLOOR = { kind: "floor", value: 100_000 } as const;
const line = (postedBucket: FilterState["postedBucket"]) =>
    searchResultLine({ count: { kind: "exact", value: 344_549 }, postedBucket, lastUpdated: null, nowMs: Date.now(), narrowed: false });

test("the count sentence names a window only when one is applied", () => {
    assert.doesNotMatch(line(undefined), /last 30 days/, "captioned an unfiltered corpus as a 30-day slice");
    assert.match(line("30d"), /last 30 days/, "sibling: a real window is still named");
});

test("the beyond-window reveal hides when no window is applied — even at the count cap", () => {
    // The floor branch shows the affordance whenever EITHER count is capped.
    // Handed the unapplied 30d it offered "more roles beyond 30 days" for
    // roles already on screen, since both counts came from the same search.
    assert.deepEqual(resolveBeyondWindow(undefined, FLOOR, FLOOR), { show: false, extra: null });
    assert.equal(resolveBeyondWindow("30d", FLOOR, FLOOR).show, true, "sibling: still reveals under a real 30d window");
});

test("the SERP hands the window-speaking consumers the applied value, never the raw state", () => {
    // A positive assertion, not an absence one: page.tsx keeps a raw
    // `postedBucket` for URL/state plumbing, so banning the identifier there
    // would be wrong. What must hold is that these three specific reads take
    // the applied window. A rename breaks this loudly, which is the point.
    const page = readFileSync(new URL("../../src/app/jobs/page.tsx", import.meta.url), "utf8");
    assert.match(page, /const appliedPosted = appliedPostedBucket\(filterState\)/);
    assert.match(page, /searchResultLine\(\{[^}]*postedBucket: appliedPosted/);
    assert.match(page, /resolveBeyondWindow\(appliedPosted,/);
    assert.match(page, /if \(appliedPosted === "30d"\)/, "the beyond-window probe must not re-run the identical search");
});

/** Every jobs surface source, discovered — never an enumerated file list. */
const JOBS_SOURCES = ["src/components/jobs", "src/app/jobs"].flatMap((dir) =>
    readdirSync(new URL(`../../${dir}`, import.meta.url))
        .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
        .map((f) => ({
            path: `${dir}/${f}`,
            src: readFileSync(new URL(`../../${dir}/${f}`, import.meta.url), "utf8"),
        })),
);

/** Files that draw the Posted control at all — by the symbols only a posted
 *  picker/label can use, so a new surface is discovered, not registered. */
const POSTED_SURFACES = JOBS_SOURCES.filter(({ src }) =>
    /POSTED_BUCKET_PRESETS|POSTED_CHIP_CYCLE|postedBucketLabel|DATE_POSTED_SHORT_LABELS/.test(src),
);

test("every surface that draws the Posted control consults the applied-window predicate", () => {
    assert.ok(POSTED_SURFACES.length >= 4, `expected the known posted surfaces, found ${POSTED_SURFACES.length}`);
    const offenders = POSTED_SURFACES.filter(({ src }) => !src.includes("appliedPostedBucket")).map((f) => f.path);
    assert.deepEqual(offenders, [], "a posted surface reading state.postedBucket raw will draw a filter that isn't applied");
});

test("no posted surface decides display from the raw bucket — the drift this file exists to stop", () => {
    // Presence sibling for the absence assertion: the offenders list above
    // would also be empty if every control were deleted, so pin that the
    // controls are still rendered AND that none of them tests the raw field.
    // The file that DEFINES the predicate is exempt — identified by the
    // export, not by name — since unwrapping the raw bucket exactly once is
    // the whole job of a chokepoint.
    const consumers = POSTED_SURFACES.filter(({ src }) => !/export function appliedPostedBucket/.test(src));
    assert.equal(POSTED_SURFACES.length - consumers.length, 1, "the predicate must have exactly one definition site");
    for (const { path, src } of consumers) {
        const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\w])\/\/[^\n]*/g, "$1");
        // A total ban, not a list of bad spellings: reading the field at all
        // — compare, assign, or render — is the mistake. `active={raw === o}`
        // and `const x = raw;` are the same defect, and an enumeration of
        // operators catches only the first.
        assert.doesNotMatch(
            code,
            /\.postedBucket\b/,
            `${path} reads the raw bucket; consumers take only the applied window`,
        );
    }
    assert.ok(
        POSTED_SURFACES.some(({ src }) => src.includes("POSTED_BUCKET_PRESETS.map")),
        "the posted picker must still be rendered somewhere",
    );
});
