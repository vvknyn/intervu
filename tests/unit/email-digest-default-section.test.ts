import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    isDefaultDigestEnabled,
    defaultDigestSearchState,
    DEFAULT_DIGEST_FLAG,
} from "@/lib/email/digest/default-section";
import { DEFAULT_URL_STATE } from "@/lib/jobs/url-state";
import type { SearchPreferences } from "@/lib/agent/preferences";

describe("isDefaultDigestEnabled", () => {
    // The lane sends email to people who never asked for any. Off unless
    // something explicitly says otherwise is the only safe default.
    it("is off when the flag is absent", () => {
        assert.equal(isDefaultDigestEnabled({}), false);
    });

    it("is on only for the exact string 'true'", () => {
        assert.equal(isDefaultDigestEnabled({ [DEFAULT_DIGEST_FLAG]: "true" }), true);
    });

    // Truthiness would read every one of these as ON, because they are all
    // non-empty strings — the wrong direction to be wrong in for a mail send.
    it("stays off for values that merely look set", () => {
        for (const value of ["0", "false", "no", "off", "", " "]) {
            assert.equal(isDefaultDigestEnabled({ [DEFAULT_DIGEST_FLAG]: value }), false, value);
        }
    });
});

describe("defaultDigestSearchState", () => {
    it("falls back to the board's own default state when nothing is configured", () => {
        const state = defaultDigestSearchState(undefined);
        assert.equal(state.q, "");
        assert.equal(state.salaryMin, DEFAULT_URL_STATE.salaryMin);
        assert.deepEqual(state.facets, {});
        assert.equal(state.hideGhosts, true);
    });

    it("carries the stated query across, trimmed", () => {
        assert.equal(defaultDigestSearchState({ query: "  staff engineer " }).q, "staff engineer");
    });

    it("carries a positive salary floor, and ignores a zero or negative one", () => {
        assert.equal(defaultDigestSearchState({ salaryMin: 120000 }).salaryMin, 120000);
        for (const salaryMin of [0, -1]) {
            assert.equal(defaultDigestSearchState({ salaryMin }).salaryMin, DEFAULT_URL_STATE.salaryMin);
        }
    });

    // The facet value comes from `parseWorkTypeTokens`, the corpus's own
    // canonicalizer, rather than a literal spelled out in the mapper — so it
    // cannot drift from the vocabulary the index actually holds.
    it("maps remoteOnly onto the corpus work_type vocabulary", () => {
        assert.deepEqual(defaultDigestSearchState({ remoteOnly: true }).facets, { work_type: ["remote"] });
        assert.deepEqual(defaultDigestSearchState({ remoteOnly: false }).facets, {});
    });

    /**
     * A regression guard, not an omission. Each of these is a preference the
     * board cannot express faithfully, and guessing produces a digest that
     * is silently EMPTY rather than visibly wrong:
     *
     * - `location` has no free-text counterpart — the board filters by a
     *   `location_country` facet, and "London" is not a country.
     * - `experienceLevel`/`employmentType` are closed facet vocabularies,
     *   but arrive as arbitrary strings over the MCP wire; an unmatched
     *   value does not error, it filters to zero hits.
     *
     * A future edit that "helpfully" maps them should fail here first.
     */
    it("does not invent facet filters from preferences the board cannot express", () => {
        const preferences: SearchPreferences = {
            location: "London",
            experienceLevel: "Senior-ish",
            employmentType: "Full Time",
        };
        assert.deepEqual(defaultDigestSearchState(preferences).facets, {});
    });

    // The cursor already bounds the digest to "since your last one". A
    // narrower window could only drop roles the reader has not seen.
    it("leaves the posted window at the board default rather than narrowing it", () => {
        assert.equal(defaultDigestSearchState({ postedWithinDays: 1 }).postedBucket, DEFAULT_URL_STATE.postedBucket);
    });
});
