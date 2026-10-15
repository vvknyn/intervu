/**
 * The one-paragraph reason (explainMatch) names what the posting asks for that the résumé shows. The daily
 * picks email and the MCP `why` carry only this paragraph, and it said title, place and level and never
 * the work: checked on Vivek's 17 postings against his product résumé (2026-10-15), where Jobber's reads
 * "roadmap, saas and product management" and Ontic's "rest api and llm".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { explainMatch } from "../../src/lib/match/explain";
import type { MatchComponent, MatchScore } from "../../src/lib/match/score";

const relevance = (evidenceTerms: string[] | undefined, score = 1): MatchComponent => ({
    key: "relevance",
    label: "Relevance to this role",
    detail: "",
    score,
    terms: { matched: 3, of: 3 },
    ...(evidenceTerms ? { jd: { fit: score, matched: evidenceTerms, missing: [], evidence: evidenceTerms.length, evidenceTerms } } : {}),
});

const location: MatchComponent = { key: "location", label: "Location", detail: "", score: 1, reason: "same_country" };

const scored = (over: Partial<MatchScore>, evidenceTerms: string[] | undefined, relevanceScore = 1): MatchScore => ({
    total: 90,
    role: "own",
    yourRole: "Product Manager",
    components: [relevance(evidenceTerms, relevanceScore), location],
    ...over,
});

describe("what the posting asks for, in the reason", () => {
    it("names up to three of the posting's terms the résumé shows, after the role and before the place", () => {
        const text = explainMatch(scored({}, ["roadmap", "saas", "product management", "management"]));
        assert.equal(
            text,
            "It's your own role: the title matches Product Manager on your résumé. The posting asks for roadmap, saas and product management, which your résumé shows. It's in your country.",
        );
    });

    it("lists a word once when a longer term holds it, and a plural once", () => {
        assert.match(explainMatch(scored({}, ["rest api", "llm", "rest", "api"])), /The posting asks for rest api and llm, which your résumé shows\./);
        assert.match(explainMatch(scored({}, ["api", "roadmap", "product management", "apis"])), /The posting asks for api, roadmap and product management, which/);
        assert.match(explainMatch(scored({}, ["roadmaps", "sql", "roadmap"])), /The posting asks for roadmaps and sql, which/);
    });

    it("says nothing about the work from a single term, or when no posting text was read", () => {
        for (const terms of [["roadmap"], ["roadmap", "roadmaps"], [], undefined]) {
            assert.doesNotMatch(explainMatch(scored({}, terms)), /The posting asks for/, JSON.stringify(terms));
        }
    });

    it("applies to a role in the same kind of work and to one whose title the résumé doesn't tie to a role", () => {
        assert.match(explainMatch(scored({ role: "family" }, ["sql", "jira"])), /same kind of work as your Product Manager role, under a different title\. The posting asks for sql and jira/);
        assert.match(explainMatch(scored({ role: "unverified", total: 79 }, ["roadmap", "releases"])), /so it can't be a Strong match\. The posting asks for roadmap and releases/);
    });

    it("leaves a different kind of role, and one that already names its terms as content-led, as they were", () => {
        assert.doesNotMatch(explainMatch(scored({ role: "off-target", total: 55 }, ["sql", "jira"])), /The posting asks for sql/);
        const led = explainMatch(scored({ role: "adjacent", contentLed: true }, ["sql", "jira", "confluence"]));
        assert.match(led, /posting asks for what your résumé shows \(sql, jira and confluence\)\./);
        assert.equal(led.match(/The posting asks for/g), null);
    });

    it("gives a fit short of full marks its share and the terms in one clause, not a second sentence", () => {
        const text = explainMatch(scored({ total: 85 }, ["data", "roadmap", "product management"], 0.91));
        assert.match(text, /Your résumé shows 91% of what the posting asks for \(data, roadmap and product management\)\./);
        assert.doesNotMatch(text, /The posting asks for/);
    });

    it("leaves a Stretch to say what holds it", () => {
        const level: MatchComponent = { key: "seniority", label: "Seniority", detail: "", score: 0, reason: "level_below_ask" };
        const text = explainMatch(scored({ total: 59, components: [relevance(["roadmap", "saas"]), location, level] }, undefined));
        assert.match(text, /It's a Stretch because/);
        assert.doesNotMatch(text, /The posting asks for/);
    });

    it("says it for a role that doesn't say where it hires, whose label is no fit word", () => {
        const unplaced: MatchComponent = { key: "location", label: "Location", detail: "", score: 0.6, reason: "remote_unplaced", unknown: true };
        const text = explainMatch(scored({ total: 79, components: [relevance(["postgres", "api", "product management"]), unplaced] }, undefined));
        assert.match(text, /It's your own role: the title matches Product Manager on your résumé\. The posting asks for postgres, api and product management, which your résumé shows\. On your résumé alone it would be Good\./);
    });
});
