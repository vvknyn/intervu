import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickRemoteFacetValue, nextSalaryPreset } from "../../src/components/jobs/FilterChipsRow";
import {
    entriesNeedingOwnChip,
    chipLabelForEntry,
    facetKeyLabel,
} from "../../src/components/jobs/FilterPanel";
import { FACET_BAR_FACETS, facetBarRepresents } from "../../src/components/jobs/FacetBar";
import { FACETABLE_KEYS, type FacetKey } from "../../src/lib/jobs/types";

// Controller resolution #1 (Task 10): the "Remote" chip must derive its
// facet value by matching /remote/i against distribution.work_type keys —
// never a hardcoded "remote" string, since the corpus's exact spelling/
// casing isn't a contract. Two DISTINCT distribution shapes below prove
// that: neither is a lowercase-exact "remote" match resolved by accident.

test("derives the remote value from a lowercase-snake distribution shape", () => {
    const v = pickRemoteFacetValue({ work_type: { remote: 40, onsite: 12, hybrid: 8 } });
    assert.equal(v, "remote");
});

test("derives the remote value from a differently-cased, differently-spelled distribution shape", () => {
    const v = pickRemoteFacetValue({ work_type: { Onsite: 5, "Remote (US)": 3, Hybrid: 2 } });
    assert.equal(v, "Remote (US)");
});

test("picks the highest-count match when more than one key looks like remote", () => {
    const v = pickRemoteFacetValue({ work_type: { remote_us: 2, remote: 9, onsite: 4 } });
    assert.equal(v, "remote");
});

test("returns undefined when no work_type value matches /remote/i", () => {
    assert.equal(pickRemoteFacetValue({ work_type: { onsite: 5, hybrid: 3 } }), undefined);
});

test("returns undefined when the facet distribution hasn't loaded yet", () => {
    assert.equal(pickRemoteFacetValue(undefined), undefined);
    assert.equal(pickRemoteFacetValue({}), undefined);
});

// Review fix (2026-07-19): nextSalaryPreset used to findIndex the exact
// current value, so an off-ladder salaryMin (e.g. a hand-edited/legacy URL)
// returned -1 and the first tap CLEARED instead of stepping up. Fixed to
// find the next preset ABOVE current, generically — covered for an
// off-ladder value that sits BETWEEN two presets, not a special case of one
// specific number.

test("steps to the next preset above an exact preset value", () => {
    assert.equal(nextSalaryPreset(0), 30_000);
    assert.equal(nextSalaryPreset(50_000), 75_000);
});

test("wraps from the top preset back to Any", () => {
    assert.equal(nextSalaryPreset(200_000), 0);
});

test("steps UP from an off-ladder value instead of clearing", () => {
    // 60,000 sits between the $50k and $75k presets (G1 added $30k/$75k
    // rungs to this ladder) — the regression returned "Any" (0) here.
    assert.equal(nextSalaryPreset(60_000), 75_000);
});

test("wraps an off-ladder value above every preset back to Any", () => {
    assert.equal(nextSalaryPreset(999_000), 0);
});

/**
 * The toolbar's per-filter chip row was removed 2026-08-15 as "duplicate
 * information" — correct for the filters the FacetBar shows as dropdowns,
 * wrong for the ones it doesn't. `location_country` is set from the location
 * box and has no chip anywhere, so setting a location left "Clear filters
 * (1)" naming nothing. These pin the rule that decides which entries the
 * toolbar has to name itself.
 */
test("entriesNeedingOwnChip: keeps only what the FacetBar has no control for", () => {
    const entries = [
        { key: "location_country:Bangalore" },
        { key: "work_type:remote" },
        { key: "experience_level:senior" },
        { key: "employment_type:contract" },
        { key: "salaryMin" },
        { key: "postedBucket" },
        { key: "visaOnly" },
    ];
    const kept = entriesNeedingOwnChip(entries, facetBarRepresents(true)).map((e) => e.key);
    assert.deepEqual(kept, ["location_country:Bangalore", "employment_type:contract", "visaOnly"]);
});

test("entriesNeedingOwnChip: when the backend can't do posted-date, the bar hides that chip — so the toolbar must name it", () => {
    const entries = [{ key: "postedBucket" }, { key: "work_type:remote" }];
    assert.deepEqual(
        entriesNeedingOwnChip(entries, facetBarRepresents(false)).map((e) => e.key),
        ["postedBucket"],
        "a filter the bar stopped rendering is no longer represented by it",
    );
});

test("facetBarRepresents never claims a facet that isn't facetable — a typo here would silently hide a chip forever", () => {
    for (const f of FACET_BAR_FACETS) {
        assert.ok(
            (FACETABLE_KEYS as readonly string[]).includes(f.key),
            `${f.key} is not in FACETABLE_KEYS`,
        );
    }
});

test("chipLabelForEntry: a facet entry names its filter; a standalone entry is already a phrase", () => {
    assert.equal(
        chipLabelForEntry({ key: "location_country:Bangalore", label: "Bangalore" }),
        "Location · Bangalore",
        "with no dropdown on the bar, the value alone doesn't say WHICH filter it is",
    );
    assert.equal(
        chipLabelForEntry({ key: "employment_type:contract", label: "Contract" }),
        "Employment · Contract",
    );
    assert.equal(chipLabelForEntry({ key: "visaOnly", label: "Sponsors visas" }), "Sponsors visas");
});

test("facetKeyLabel: unmapped keys still get a readable name, so a new facet needs no edit here", () => {
    assert.equal(facetKeyLabel("location_country"), "Location");
    assert.equal(facetKeyLabel("source" as FacetKey), "Source");
});

/**
 * One door into the filter panel, per surface.
 *
 * The quick-filter row used to carry its own "Filters" chip alongside the
 * toolbar's `filters-toggle`, so a phone rendered two identically labelled
 * buttons about 60px apart, both opening the same sheet (2026-08-24). The fix
 * removed the PROP that fed it, not just the button — but a prop can be added
 * back, so this counts doors at the page level rather than watching one
 * component. A third door added anywhere in the SERP fails this too.
 */
const JOBS_PAGE_SRC = readFileSync(
    new URL("../../src/app/jobs/JobsContent.tsx", import.meta.url),
    "utf8",
);
const CHIPS_ROW_SRC = readFileSync(
    new URL("../../src/components/jobs/FilterChipsRow.tsx", import.meta.url),
    "utf8",
);

/** Doc comments legitimately discuss the button this file no longer renders. */
const chipsRowCode = CHIPS_ROW_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\w])\/\/[^\n]*/g, "$1");

test("the SERP mounts exactly one control that opens the filter panel", () => {
    const doors = (JOBS_PAGE_SRC.match(/data-testid="filters-toggle"/g) ?? []).length;
    assert.equal(doors, 1, "two controls opening the same panel is the duplication this guards");
});

test("the filter panel is still reachable — the guard above must not pass by deleting every door", () => {
    // A probe for absence proves nothing until presence is proven too: zero
    // doors would fail the count above, but a door wired to nothing would not.
    assert.match(JOBS_PAGE_SRC, /onClick=\{\(\) => setFiltersOpen\(/);
    assert.match(JOBS_PAGE_SRC, /<Sheet open=\{filtersOpen\} onOpenChange=\{setFiltersOpen\}>/);
});

test("the quick-filter row cannot open the panel at all", () => {
    assert.doesNotMatch(chipsRowCode, /onOpenSheet|onOpen[A-Z]/, "no panel-opening prop may return to this row");
    assert.doesNotMatch(chipsRowCode, /\bFilters\b/, "no control here may be labelled Filters");
    // It is still a quick-filter row, not an empty div.
    assert.match(chipsRowCode, /aria-label="Quick filters"/);
});
