import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAtRest, showsFrontDoorBand } from "../../src/lib/jobs/front-door-state";

describe("isAtRest", () => {
    it("no query, no job — at rest", () => {
        assert.equal(isAtRest({ query: "", jobParam: null }), true);
    });

    it("whitespace-only query still reads as empty — at rest", () => {
        assert.equal(isAtRest({ query: "   ", jobParam: null }), true);
    });

    it("a typed query — not at rest", () => {
        assert.equal(isAtRest({ query: "nurse", jobParam: null }), false);
    });

    it("a selected job (?job=) with no query — not at rest", () => {
        assert.equal(isAtRest({ query: "", jobParam: "abc123" }), false);
    });

    it("both a query and a job — not at rest", () => {
        assert.equal(isAtRest({ query: "nurse", jobParam: "abc123" }), false);
    });
});

describe("showsFrontDoorBand", () => {
    it("at rest, signed out, no résumé — show the band", () => {
        assert.equal(
            showsFrontDoorBand({ atRest: true, signedIn: false, resumeOnFile: false, fitActive: false }),
            true,
        );
    });

    it("at rest, signed in, server confirms no résumé — show the band", () => {
        assert.equal(
            showsFrontDoorBand({ atRest: true, signedIn: true, resumeOnFile: false, fitActive: false }),
            true,
        );
    });

    it("not at rest (a query is running) — never show the band, even with no résumé", () => {
        assert.equal(
            showsFrontDoorBand({ atRest: false, signedIn: false, resumeOnFile: false, fitActive: false }),
            false,
        );
    });

    it("at rest but résumé confirmed on file — nothing left to invite", () => {
        assert.equal(
            showsFrontDoorBand({ atRest: true, signedIn: true, resumeOnFile: true, fitActive: false }),
            false,
        );
    });

    it("at rest but already ranking by fit — the band has nothing left to offer", () => {
        assert.equal(
            showsFrontDoorBand({ atRest: true, signedIn: false, resumeOnFile: false, fitActive: true }),
            false,
        );
    });

    it("at rest, résumé presence unknown (server round trip not back yet) — stay quiet", () => {
        assert.equal(
            showsFrontDoorBand({ atRest: true, signedIn: true, resumeOnFile: null, fitActive: false }),
            false,
        );
    });
});
