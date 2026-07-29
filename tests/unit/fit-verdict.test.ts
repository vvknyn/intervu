import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    verdictFromRecommendationCounts,
    buildFitAssessment,
    splitRecommendationBullets,
} from "@/lib/jobs/fit-verdict";
import type { TailoringRecommendation } from "@/types/resume";

describe("verdictFromRecommendationCounts", () => {
    it("strong when matches dominate", () => {
        assert.equal(verdictFromRecommendationCounts({ match: 5, gap: 1 }), "strong");
    });
    it("stretch when mixed", () => {
        assert.equal(verdictFromRecommendationCounts({ match: 3, gap: 3 }), "stretch");
    });
    it("weak when gaps dominate", () => {
        assert.equal(verdictFromRecommendationCounts({ match: 1, gap: 4 }), "weak");
    });
});

function rec(partial: Partial<TailoringRecommendation>): TailoringRecommendation {
    return {
        id: partial.id ?? "r1",
        category: partial.category ?? "experience",
        priority: partial.priority ?? "medium",
        title: partial.title ?? "Title",
        reasoning: partial.reasoning ?? "Reasoning text",
        suggested: partial.suggested ?? "suggested",
        original: partial.original,
    };
}

describe("splitRecommendationBullets", () => {
    it("maps high-priority items to gaps and medium/low to matches", () => {
        const items = [
            rec({ id: "g1", priority: "high", reasoning: "Missing HIPAA experience" }),
            rec({ id: "m1", priority: "medium", reasoning: "Strong K8s background" }),
            rec({ id: "m2", priority: "low", reasoning: "Go listed on resume" }),
        ];
        assert.deepEqual(splitRecommendationBullets(items), {
            matches: ["Strong K8s background", "Go listed on resume"],
            gaps: ["Missing HIPAA experience"],
            matchCount: 2,
            gapCount: 1,
        });
    });

    it("caps display bullets at 3 matches and 2 gaps", () => {
        const items = [
            rec({ id: "m1", priority: "medium", reasoning: "match 1" }),
            rec({ id: "m2", priority: "medium", reasoning: "match 2" }),
            rec({ id: "m3", priority: "low", reasoning: "match 3" }),
            rec({ id: "m4", priority: "low", reasoning: "match 4" }),
            rec({ id: "g1", priority: "high", reasoning: "gap 1" }),
            rec({ id: "g2", priority: "high", reasoning: "gap 2" }),
            rec({ id: "g3", priority: "high", reasoning: "gap 3" }),
        ];
        const out = splitRecommendationBullets(items);
        assert.deepEqual(out.matches, ["match 1", "match 2", "match 3"]);
        assert.deepEqual(out.gaps, ["gap 1", "gap 2"]);
        assert.equal(out.matchCount, 4);
        assert.equal(out.gapCount, 3);
    });
});

describe("buildFitAssessment", () => {
    it("derives verdict and bullets from recommendation priorities", () => {
        const assessment = buildFitAssessment(
            [
                rec({ priority: "high", reasoning: "No on-call lead experience" }),
                rec({ priority: "medium", reasoning: "6+ years platform work" }),
                rec({ priority: "low", reasoning: "Terraform in production" }),
            ],
            "analysis-123",
        );
        assert.equal(assessment.verdict, "strong");
        assert.deepEqual(assessment.matches, ["6+ years platform work", "Terraform in production"]);
        assert.deepEqual(assessment.gaps, ["No on-call lead experience"]);
        assert.equal(assessment.analysisId, "analysis-123");
    });
});
