import type { TailoringRecommendation } from "@/types/resume";

export type FitVerdictLabel = "strong" | "stretch" | "weak";

export type FitAssessment = {
    verdict: FitVerdictLabel;
    matches: string[];
    gaps: string[];
    analysisId?: string;
};

/** Max bullets shown in the fit drawer (spec: 3 matches, ≤2 gaps). */
export const MAX_MATCH_BULLETS = 3;
export const MAX_GAP_BULLETS = 2;

/**
 * Verdict thresholds (count-based, from tailor recommendation priorities):
 * - strong: matchCount > gapCount (matches dominate)
 * - stretch: matchCount === gapCount (mixed)
 * - weak: gapCount > matchCount (gaps dominate)
 */
export function verdictFromRecommendationCounts(counts: {
    match: number;
    gap: number;
}): FitVerdictLabel {
    if (counts.match > counts.gap) return "strong";
    if (counts.gap > counts.match) return "weak";
    return "stretch";
}

/** Tailor marks critical requirement gaps as high priority; reframes are medium/low. */
export function isGapRecommendation(rec: TailoringRecommendation): boolean {
    return rec.priority === "high";
}

function bulletText(rec: TailoringRecommendation): string {
    const text = rec.reasoning?.trim() || rec.title?.trim();
    return text || "Relevant experience noted";
}

export function splitRecommendationBullets(recommendations: TailoringRecommendation[]): {
    matches: string[];
    gaps: string[];
    matchCount: number;
    gapCount: number;
} {
    const matchItems: TailoringRecommendation[] = [];
    const gapItems: TailoringRecommendation[] = [];

    for (const rec of recommendations) {
        if (isGapRecommendation(rec)) gapItems.push(rec);
        else matchItems.push(rec);
    }

    return {
        matches: matchItems.slice(0, MAX_MATCH_BULLETS).map(bulletText),
        gaps: gapItems.slice(0, MAX_GAP_BULLETS).map(bulletText),
        matchCount: matchItems.length,
        gapCount: gapItems.length,
    };
}

export function buildFitAssessment(
    recommendations: TailoringRecommendation[],
    analysisId?: string,
): FitAssessment {
    const { matches, gaps, matchCount, gapCount } = splitRecommendationBullets(recommendations);
    return {
        verdict: verdictFromRecommendationCounts({ match: matchCount, gap: gapCount }),
        matches,
        gaps,
        analysisId,
    };
}
