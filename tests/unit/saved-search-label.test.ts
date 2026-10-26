import { test } from "node:test";
import assert from "node:assert/strict";
import {
    addSavedSearch,
    effectiveSavedSearchState,
    hrefFromJobsUrlState,
    mergedSavedSearchRow,
    originField,
    savedSearchDisplay,
    savedSearchOrigin,
    suggestSavedSearchName,
    RESUME_KEYWORDS_LABEL,
    type SavedSearch,
} from "../../src/lib/jobs/saved-searches";
import { DEFAULT_URL_STATE } from "../../src/lib/jobs/url-state";

const OLD_Q = '"Product Manager" OR "Program Manager" OR "Growth PM"';
const NEW_Q = '"Staff Engineer" OR "Platform Engineer"';

function row(q: string, over: Partial<SavedSearch> = {}): SavedSearch {
    const state = { ...DEFAULT_URL_STATE, q };
    return { id: "1", name: suggestSavedSearchName(state), href: hrefFromJobsUrlState(state), createdAt: "2026-10-26T00:00:00Z", ...over };
}

test("résumé origin reads as Résumé keywords, with every term for the tooltip", () => {
    const d = savedSearchDisplay(row(OLD_Q, { origin: "resume" }), OLD_Q);
    assert.equal(d.label, RESUME_KEYWORDS_LABEL);
    assert.deepEqual(d.terms, ["Product Manager", "Program Manager", "Growth PM"]);
});

test("a legacy raw-query name with no origin reads as first term + N more, never Résumé keywords", () => {
    const d = savedSearchDisplay(row(OLD_Q), null);
    assert.equal(d.label, "Product Manager +2 more");
    assert.deepEqual(d.terms, ["Product Manager", "Program Manager", "Growth PM"]);
});

test("a name the user typed is shown as written, with or without an origin", () => {
    assert.deepEqual(savedSearchDisplay(row(OLD_Q, { name: "PM roles in Berlin" }), null), { label: "PM roles in Berlin", terms: null });
    assert.deepEqual(savedSearchDisplay(row(OLD_Q, { name: "My list", origin: "resume" }), OLD_Q), { label: "My list", terms: null });
});

test("a single-term query keeps its own name and has no tooltip", () => {
    assert.deepEqual(savedSearchDisplay(row("designer"), null), { label: "designer", terms: null });
});

test("an unquoted boolean query is summarised too", () => {
    assert.equal(savedSearchDisplay(row("pm OR designer"), null).label, "pm +1 more");
});

test("origin is recorded only when the query IS the fit-derived one, never from the text", () => {
    const state = { ...DEFAULT_URL_STATE, q: OLD_Q };
    assert.equal(savedSearchOrigin(state, OLD_Q), "resume");
    assert.equal(savedSearchOrigin(state, null), undefined, "same quoted-OR text typed by the user");
    assert.equal(savedSearchOrigin(state, NEW_Q), undefined);
    assert.equal(savedSearchOrigin({ ...DEFAULT_URL_STATE, q: "" }, ""), undefined);
});

test("a résumé change moves a résumé-origin search's applied query, tooltip terms and count input", () => {
    const s = row(OLD_Q, { origin: "resume" });
    assert.equal(effectiveSavedSearchState(s, OLD_Q).q, OLD_Q);
    assert.equal(effectiveSavedSearchState(s, NEW_Q).q, NEW_Q);
    assert.deepEqual(savedSearchDisplay(s, NEW_Q), { label: RESUME_KEYWORDS_LABEL, terms: ["Staff Engineer", "Platform Engineer"] });
});

test("no résumé on the device: the stored query stands", () => {
    const s = row(OLD_Q, { origin: "resume" });
    assert.equal(effectiveSavedSearchState(s, null).q, OLD_Q);
    assert.equal(effectiveSavedSearchState(s, "  ").q, OLD_Q);
});

test("a search not saved from the résumé never changes when the résumé does", () => {
    const legacy = row(OLD_Q);
    const typed = row(OLD_Q, { name: "mine" });
    for (const s of [legacy, typed]) {
        assert.equal(effectiveSavedSearchState(s, NEW_Q).q, OLD_Q);
        assert.deepEqual(savedSearchDisplay(s, NEW_Q), savedSearchDisplay(s, null));
    }
});

test("origin survives the guest store, the sign-in merge and rejects anything but resume", () => {
    const [saved] = addSavedSearch([], { name: "n", href: "?q=a", origin: "resume" });
    assert.equal(saved.origin, "resume");
    assert.equal("origin" in addSavedSearch([], { name: "n", href: "?q=a" })[0], false);
    assert.equal(mergedSavedSearchRow({ name: "n", href: "?q=a", createdAt: "2026-01-01T00:00:00Z", origin: "resume" }, undefined).origin, "resume");
    assert.deepEqual(originField("anything"), {});
    assert.deepEqual(originField(undefined), {});
});
