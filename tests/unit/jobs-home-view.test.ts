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
    });

    it("view=for-you requires a résumé on file", () => {
        assert.equal(resolveJobsHomeView({ ...base, urlView: "for-you", resumeOnFile: true }), "for-you");
        assert.equal(resolveJobsHomeView({ ...base, urlView: "for-you", resumeOnFile: false }), "search");
        assert.equal(resolveJobsHomeView({ ...base, urlView: "for-you", resumeOnFile: null }), "search");
    });

    it("company or board scope forces search", () => {
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: true, companyDomain: "acme.com" }),
            "search",
        );
        assert.equal(resolveJobsHomeView({ ...base, resumeOnFile: true, board: "elite" }), "search");
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
    });

    it("résumé-derived fit query does not force search", () => {
        assert.equal(
            resolveJobsHomeView({ ...base, resumeOnFile: true, q: "software engineer", sort: "fit" }),
            "for-you",
        );
    });

    it("résumé on file defaults to for-you", () => {
        assert.equal(resolveJobsHomeView({ ...base, resumeOnFile: true }), "for-you");
    });

    it("unknown or missing résumé defaults to search", () => {
        assert.equal(resolveJobsHomeView({ ...base, resumeOnFile: false }), "search");
        assert.equal(resolveJobsHomeView({ ...base, resumeOnFile: null }), "search");
    });
});
