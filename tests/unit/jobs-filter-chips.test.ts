import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRemoteFacetValue, nextSalaryPreset } from "../../src/components/jobs/FilterChipsRow";

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
    assert.equal(nextSalaryPreset(0), 50_000);
    assert.equal(nextSalaryPreset(50_000), 100_000);
});

test("wraps from the top preset back to Any", () => {
    assert.equal(nextSalaryPreset(200_000), 0);
});

test("steps UP from an off-ladder value instead of clearing", () => {
    // 75,000 sits between the $50k and $100k presets — the regression
    // returned "Any" (0) here.
    assert.equal(nextSalaryPreset(75_000), 100_000);
});

test("wraps an off-ladder value above every preset back to Any", () => {
    assert.equal(nextSalaryPreset(999_000), 0);
});
