import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildFitReasonRows,
    fitReasonSourcesFromComponents,
    type FitReasonSource,
} from "../../src/lib/jobs/for-you/fit-reasons";
import type { MatchComponent } from "../../src/lib/match/score";

describe("buildFitReasonRows", () => {
    it("renders single-column from `detail` when only one side is supplied", () => {
        const sources: FitReasonSource[] = [
            { key: "relevance", label: "Relevance", detail: "7 of 12 terms this role names" },
        ];
        const rows = buildFitReasonRows(sources);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].columns, "single");
        assert.equal(rows[0].singleText, "7 of 12 terms this role names");
        assert.equal(rows[0].resumeText, null);
        assert.equal(rows[0].postingText, null);
    });

    it("renders two columns only when BOTH resumeDetail and postingDetail are present", () => {
        const sources: FitReasonSource[] = [
            {
                key: "seniority",
                label: "Seniority",
                detail: "senior — fits",
                resumeDetail: "6 years as a senior engineer",
                postingDetail: "Looking for a senior-level hire",
            },
        ];
        const rows = buildFitReasonRows(sources);
        assert.equal(rows[0].columns, "two");
        assert.equal(rows[0].resumeText, "6 years as a senior engineer");
        assert.equal(rows[0].postingText, "Looking for a senior-level hire");
        assert.equal(rows[0].singleText, null);
    });

    it("never fabricates a placeholder for a missing side — falls back to single-column", () => {
        const onlyResumeSide: FitReasonSource[] = [
            { key: "location", label: "Location", detail: "on-site, matches your area", resumeDetail: "Based in Austin, TX" },
        ];
        const rows = buildFitReasonRows(onlyResumeSide);
        assert.equal(rows[0].columns, "single", "one side present is not enough for two columns");
        assert.equal(rows[0].singleText, "on-site, matches your area");
        assert.equal(rows[0].resumeText, null, "must not leak the partial resumeDetail into a fabricated two-column row");
    });

    it("covers a mixed batch: some rows single, some two-column, order preserved", () => {
        const sources: FitReasonSource[] = [
            { key: "relevance", label: "Relevance", detail: "single a" },
            { key: "seniority", label: "Seniority", detail: "fallback", resumeDetail: "r", postingDetail: "p" },
            { key: "location", label: "Location", detail: "single c" },
        ];
        const rows = buildFitReasonRows(sources);
        assert.deepEqual(rows.map((r) => r.columns), ["single", "two", "single"]);
        assert.deepEqual(rows.map((r) => r.key), ["relevance", "seniority", "location"]);
    });
});

describe("fitReasonSourcesFromComponents", () => {
    it("adapts real MatchComponent[] (score.ts) — which never carries split fields — to always-single-column sources", () => {
        const components: MatchComponent[] = [
            { key: "relevance", label: "Relevance", detail: "7 of 12 terms this role names", score: 0.6 },
            { key: "seniority", label: "Seniority", detail: "senior — fits", score: 1 },
        ];
        const sources = fitReasonSourcesFromComponents(components);
        const rows = buildFitReasonRows(sources);
        assert.ok(rows.every((r) => r.columns === "single"), "real score.ts data has no split fields to adapt");
        assert.deepEqual(
            rows.map((r) => r.singleText),
            ["7 of 12 terms this role names", "senior — fits"],
        );
    });
});
