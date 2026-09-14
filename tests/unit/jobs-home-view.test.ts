import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveJobsHomeView } from "../../src/lib/jobs/for-you/home-view";

describe("resolveJobsHomeView", () => {
    const base: Parameters<typeof resolveJobsHomeView>[0] = {
        urlView: null,
        resumeOnFile: null,
        companyDomain: null,
        board: null,
        q: "",
        sort: null,
    };

    it("explicit view=search always lands on search", () => {
        assert.equal(
            resolveJobsHomeView({ ...base, urlView: "search", resumeOnFile: true }),
            "search",
        );
        assert.equal(
            resolveJobsHomeView({ ...base, urlView: "search", resumeOnFile: null }),
            "search",
        );
    });

    it("view=for-you stays on for-you until résumé is known absent", () => {
        assert.equal(resolveJobsHomeView({ ...base, urlView: "for-you", resumeOnFile: true }), "for-you");
        assert.equal(resolveJobsHomeView({ ...base, urlView: "for-you", resumeOnFile: false }), "search");
        assert.equal(resolveJobsHomeView({ ...base, urlView: "for-you", resumeOnFile: null }), "for-you");
    });

    it("company or board scope forces search", () => {
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: true, companyDomain: "acme.com" }),
            "search",
        );
        assert.equal(resolveJobsHomeView({ ...base, resumeOnFile: true, board: "elite" }), "search");
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: null, companyDomain: "acme.com" }),
            "search",
        );
    });

    it("non-empty query with non-fit sort forces search", () => {
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: true, q: "engineer", sort: "relevance" }),
            "search",
        );
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: true, q: "engineer", sort: "newest" }),
            "search",
        );
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: null, q: "engineer", sort: "relevance" }),
            "search",
        );
    });

    it("résumé-derived fit query does not force search", () => {
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: true, q: "software engineer", sort: "fit" }),
            "for-you",
        );
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: null, q: "software engineer", sort: "fit" }),
            "pending",
        );
    });

    it("résumé on file defaults to for-you", () => {
        assert.equal(resolveJobsHomeView({ ...base, resumeOnFile: true }), "for-you");
    });

    it("known-missing résumé defaults to search", () => {
        assert.equal(resolveJobsHomeView({ ...base, resumeOnFile: false }), "search");
    });

    it("unknown presence does not resolve to Search chrome", () => {
        assert.equal(resolveJobsHomeView({ ...base, resumeOnFile: null }), "pending");
        assert.notEqual(resolveJobsHomeView({ ...base, resumeOnFile: null }), "search");
    });

    it("unknown presence with last For you stays on For you", () => {
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: null, lastHomeView: "for-you" }),
            "for-you",
        );
    });

    it("unknown presence does not treat last Search as an optimistic Search flash", () => {
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: null, lastHomeView: "search" }),
            "pending",
        );
    });
});
