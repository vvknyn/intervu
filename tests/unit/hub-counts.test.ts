import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    countFitBands,
    formatHubCountLabel,
    resolveAllMatchesHubCount,
} from "../../src/lib/jobs/for-you/hub-counts";
import type { MatchScore } from "../../src/lib/match/score";

function score(total: number): MatchScore {
    return { total, components: [] };
}

describe("formatHubCountLabel", () => {
    it("never invents — omit and loading are honest", () => {
        assert.equal(formatHubCountLabel({ kind: "omit" }), "");
        assert.equal(formatHubCountLabel({ kind: "loading" }), "Matches loading");
    });

    it("formats totals without fake pack numbers", () => {
        assert.equal(formatHubCountLabel({ kind: "total", total: 1 }), "1 match");
        assert.equal(formatHubCountLabel({ kind: "total", total: 60 }), "60 matches");
        assert.doesNotMatch(formatHubCountLabel({ kind: "total", total: 60 }), /24 jobs|18 jobs|42 jobs/);
    });

    it("prefers Strong · Good band split", () => {
        assert.equal(
            formatHubCountLabel({ kind: "bands", strong: 12, good: 8 }),
            "12 Strong · 8 Good",
        );
        assert.equal(formatHubCountLabel({ kind: "bands", strong: 5, good: 0 }), "5 Strong");
    });
});

describe("resolveAllMatchesHubCount", () => {
    it("uses bands when scored hits exist", () => {
        const source = resolveAllMatchesHubCount({
            loading: false,
            total: 200,
            scores: [score(90), score(70), score(40), null],
        });
        assert.equal(source.kind, "bands");
        if (source.kind === "bands") {
            assert.equal(source.strong, 1);
            assert.equal(source.good, 1);
        }
    });

    it("falls back to total, then loading, then omit", () => {
        assert.deepEqual(
            resolveAllMatchesHubCount({ loading: false, total: 42, scores: null }),
            { kind: "total", total: 42 },
        );
        assert.deepEqual(
            resolveAllMatchesHubCount({ loading: true, total: null, scores: null }),
            { kind: "loading" },
        );
        assert.deepEqual(
            resolveAllMatchesHubCount({ loading: false, total: null, scores: null }),
            { kind: "omit" },
        );
    });
});

describe("countFitBands", () => {
    it("buckets Strong / Good / Stretch / unscored", () => {
        const bands = countFitBands([score(80), score(60), score(59), null, undefined]);
        assert.deepEqual(bands, { strong: 1, good: 1, stretch: 1, unscored: 2 });
    });
});
