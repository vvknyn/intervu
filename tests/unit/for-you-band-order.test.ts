import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orderForYouJobsByBand, matchBandSortKey } from "../../src/lib/jobs/for-you/band-order";
import type { MatchScore } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";

function job(id: string, title: string): PublicJob {
    return {
        id,
        title,
        company: "Acme",
        company_domain: "acme.com",
        apply_url: "https://example.com/apply",
        posted_at: "2026-01-01T00:00:00.000Z",
    } as PublicJob;
}

function score(total: number): MatchScore {
    return {
        total,
        components: [{ key: "relevance", label: "Relevance", detail: "test", score: total / 100 }],
    };
}

describe("matchBandSortKey", () => {
    it("orders Strong before Good before Stretch before unscored", () => {
        assert.ok(matchBandSortKey(score(85)) < matchBandSortKey(score(70)));
        assert.ok(matchBandSortKey(score(70)) < matchBandSortKey(score(40)));
        assert.ok(matchBandSortKey(score(40)) < matchBandSortKey(null));
    });

    it("uses the product boundaries: 80 Strong, 79 and 60 Good, 59 Stretch", () => {
        assert.equal(matchBandSortKey(score(80)), matchBandSortKey(score(100)));
        assert.ok(matchBandSortKey(score(80)) < matchBandSortKey(score(79)));
        assert.equal(matchBandSortKey(score(79)), matchBandSortKey(score(60)));
        assert.ok(matchBandSortKey(score(60)) < matchBandSortKey(score(59)));
    });
});

describe("orderForYouJobsByBand", () => {
    it("places Strong before Good before Stretch regardless of input order", () => {
        const stretch = job("stretch", "Software Engineer");
        const good = job("good", "Software Engineer");
        const strong = job("strong", "Software Engineer");
        const ordered = orderForYouJobsByBand(
            [stretch, good, strong],
            (j) => {
                if (j.id === "strong") return score(88);
                if (j.id === "good") return score(72);
                return score(42);
            },
            "Software Engineer",
        );
        assert.deepEqual(
            ordered.map((j) => j.id),
            ["strong", "good", "stretch"],
        );
    });

    it("keeps stable relative order within the same band", () => {
        const a = job("a", "Role A");
        const b = job("b", "Role B");
        const c = job("c", "Role C");
        const ordered = orderForYouJobsByBand(
            [a, b, c],
            (j) => score(j.id === "b" ? 82 : 81),
            "",
        );
        assert.deepEqual(
            ordered.map((j) => j.id),
            ["a", "b", "c"],
        );
    });

    it("does not let a target-title Stretch outrank a non-target Strong", () => {
        const targetStretch = job("target-stretch", "Product Manager");
        const offTargetStrong = job("off-strong", "Data Analyst");
        const ordered = orderForYouJobsByBand(
            [targetStretch, offTargetStrong],
            (j) => (j.id === "target-stretch" ? score(45) : score(90)),
            "Product Manager",
        );
        assert.deepEqual(
            ordered.map((j) => j.id),
            ["off-strong", "target-stretch"],
        );
    });

    it("sorts unscored jobs after every scored band", () => {
        const unscored = job("none", "Software Engineer");
        const stretch = job("stretch", "Software Engineer");
        const strong = job("strong", "Software Engineer");
        const ordered = orderForYouJobsByBand(
            [unscored, stretch, strong],
            (j) => (j.id === "none" ? null : j.id === "strong" ? score(90) : score(50)),
            "Software Engineer",
        );
        assert.deepEqual(
            ordered.map((j) => j.id),
            ["strong", "stretch", "none"],
        );
    });

    it("returns input order unchanged when getScore is null (no résumé path)", () => {
        const input = [job("b", "B"), job("a", "A")];
        const ordered = orderForYouJobsByBand(input, null, "A");
        assert.deepEqual(
            ordered.map((j) => j.id),
            ["b", "a"],
        );
    });
});
