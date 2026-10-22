import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { frontDoorRegions, hubGreeting, isAtRest } from "../../src/lib/jobs/front-door-state";

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

describe("frontDoorRegions", () => {
    const anon = { signedIn: false, signedOut: true, resumeOnFile: false, fitActive: false };

    it("signed out: job rows at once, and the résumé band is the one band", () => {
        assert.deepEqual(frontDoorRegions(anon), { rows: true, band: "resume" });
    });

    it("signed in without a résumé: no arrival rows, still the one résumé band", () => {
        assert.deepEqual(frontDoorRegions({ signedIn: true, signedOut: false, resumeOnFile: false, fitActive: false }), { rows: false, band: "resume" });
    });

    it("signed in with a résumé: its ranked list opens instead, no band", () => {
        assert.deepEqual(frontDoorRegions({ signedIn: true, signedOut: false, resumeOnFile: true, fitActive: false }), { rows: false, band: null });
    });

    it("signed out with fit already active or a résumé unknown: no band, rows kept", () => {
        assert.deepEqual(frontDoorRegions({ ...anon, fitActive: true }), { rows: true, band: null });
        assert.deepEqual(frontDoorRegions({ ...anon, resumeOnFile: null }), { rows: true, band: null });
    });

    it("auth not yet known: no rows (a signed-in account must not flash the signed-out list)", () => {
        assert.equal(frontDoorRegions({ ...anon, signedOut: false }).rows, false);
    });

    it("never more than one band, and no region for the pitches that moved to the footer", () => {
        for (const signedIn of [true, false]) {
            for (const resumeOnFile of [true, false, null]) {
                for (const fitActive of [true, false]) {
                    const regions = frontDoorRegions({ signedIn, signedOut: !signedIn, resumeOnFile, fitActive });
                    assert.deepEqual(Object.keys(regions).sort(), ["band", "rows"]);
                    assert.ok(regions.band === null || regions.band === "resume");
                }
            }
        }
    });
});

describe("frontDoorRegions band — who still needs the résumé invite", () => {
    const base: Parameters<typeof frontDoorRegions>[0] = { signedIn: false, signedOut: true, resumeOnFile: false, fitActive: false };
    const band = (over: Partial<typeof base>) => frontDoorRegions({ ...base, ...over }).band;

    it("signed in, server confirms no résumé — the band", () => {
        assert.equal(band({ signedIn: true, signedOut: false }), "resume");
    });

    it("résumé confirmed on file, or already ranking by fit — nothing left to invite", () => {
        assert.equal(band({ signedIn: true, signedOut: false, resumeOnFile: true }), null);
        assert.equal(band({ fitActive: true }), null);
    });

    it("résumé presence unknown (server round trip not back yet) — stay quiet", () => {
        assert.equal(band({ signedIn: true, signedOut: false, resumeOnFile: null }), null);
    });
});
