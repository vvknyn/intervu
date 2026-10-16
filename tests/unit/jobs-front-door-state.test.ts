import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hubGreeting, isAtRest, showsFrontDoorBand } from "../../src/lib/jobs/front-door-state";

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

describe("hubGreeting — derived from real state, 'Welcome back' only for a known earlier visit", () => {
    const cases = [
        { signedIn: false, userName: null, hasResume: false },
        { signedIn: false, userName: null, hasResume: true },
        { signedIn: true, userName: "Priya Raman", hasResume: true },
        { signedIn: true, userName: null, hasResume: false },
        { signedIn: true, userName: "  ", hasResume: false },
    ];
    for (const c of cases) {
        it(`never claims a prior visit (${JSON.stringify(c)})`, () => {
            assert.doesNotMatch(hubGreeting(c).title, /back/i);
        });
    }

    it("a signed-out visitor is not greeted as an account holder", () => {
        assert.equal(hubGreeting({ signedIn: false, userName: "Stale Name", hasResume: true }).title, "Your matches");
        assert.equal(hubGreeting({ signedIn: false, hasResume: false }).title, "Job packs");
    });

    it("says 'back' only when this device's own visit record shows an earlier visit, and only to a signed-in user", () => {
        assert.equal(hubGreeting({ signedIn: true, userName: "Marcus Oyelaran", hasResume: true, returning: true }).title, "Welcome back, Marcus");
        assert.equal(hubGreeting({ signedIn: true, userName: "  ", hasResume: true, returning: true }).title, "Welcome back");
        assert.equal(hubGreeting({ signedIn: true, userName: "Marcus", hasResume: true, returning: false }).title, "Welcome, Marcus");
        assert.equal(hubGreeting({ signedIn: false, userName: "Stale Name", hasResume: true, returning: true }).title, "Your matches");
    });

    it("a signed-in user is greeted by first name, or plainly without one", () => {
        assert.equal(hubGreeting({ signedIn: true, userName: "Marcus Oyelaran", hasResume: false }).title, "Welcome, Marcus");
        assert.equal(hubGreeting({ signedIn: true, userName: "  ", hasResume: false }).title, "Welcome");
    });

    it("says 'ranked against your résumé' only when a résumé exists", () => {
        assert.match(hubGreeting({ signedIn: false, hasResume: true }).subtitle, /résumé/);
        assert.doesNotMatch(hubGreeting({ signedIn: true, userName: "A", hasResume: false }).subtitle, /résumé|background/);
    });
});
