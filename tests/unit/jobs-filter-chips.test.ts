import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRemoteFacetValue } from "../../src/components/jobs/FilterChipsRow";

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
