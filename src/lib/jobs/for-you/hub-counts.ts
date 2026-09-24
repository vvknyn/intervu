/**
 * Honest hub pack count labels — never invent numbers.
 * Prefer live `result.total` and Strong/Good band splits when scored hits exist.
 * Packs without a live query yet omit the count (or show loading), never mock "24 jobs".
 */
import { matchBand, type MatchScore } from "@/lib/match/score";

export type HubCountSource =
    | { kind: "loading" }
    | { kind: "omit" }
    | { kind: "total"; total: number }
    | { kind: "bands"; strong: number; good: number; total?: number };

/** Format a hub pill — empty string means "render no count". */
export function formatHubCountLabel(source: HubCountSource): string {
    if (source.kind === "omit") return "";
    if (source.kind === "loading") return "Matches loading";
    if (source.kind === "total") {
        if (!Number.isFinite(source.total) || source.total < 0) return "";
        const n = Math.floor(source.total);
        return n === 1 ? "1 match" : `${n.toLocaleString()} matches`;
    }
    const { strong, good, total } = source;
    const s = Math.max(0, Math.floor(strong));
    const g = Math.max(0, Math.floor(good));
    if (s > 0 || g > 0) {
        const parts: string[] = [];
        if (s > 0) parts.push(`${s} Strong`);
        if (g > 0) parts.push(`${g} Good`);
        return parts.join(" · ");
    }
    if (total != null && Number.isFinite(total) && total >= 0) {
        return formatHubCountLabel({ kind: "total", total });
    }
    return "";
}

/** Count Strong / Good bands from a score map over known job ids. */
export function countFitBands(
    scores: Iterable<MatchScore | null | undefined>,
): { strong: number; good: number; stretch: number; unscored: number } {
    let strong = 0;
    let good = 0;
    let stretch = 0;
    let unscored = 0;
    for (const score of scores) {
        if (score == null || !Number.isFinite(score.total)) {
            unscored++;
            continue;
        }
        const band = matchBand(score.total);
        if (band === "strong") strong++;
        else if (band === "good") good++;
        else stretch++;
    }
    return { strong, good, stretch, unscored };
}

/**
 * Prefer Strong+Good split when we have scored hits; else honest total;
 * else loading / omit. Never fabricates a count.
 */
export function resolveAllMatchesHubCount(input: {
    loading: boolean;
    total: number | null | undefined;
    scores: Iterable<MatchScore | null | undefined> | null | undefined;
}): HubCountSource {
    if (input.scores) {
        const bands = countFitBands(input.scores);
        if (bands.strong + bands.good + bands.stretch > 0) {
            return {
                kind: "bands",
                strong: bands.strong,
                good: bands.good,
                total: input.total ?? undefined,
            };
        }
    }
    if (input.total != null && Number.isFinite(input.total) && input.total >= 0) {
        return { kind: "total", total: input.total };
    }
    if (input.loading) return { kind: "loading" };
    return { kind: "omit" };
}
