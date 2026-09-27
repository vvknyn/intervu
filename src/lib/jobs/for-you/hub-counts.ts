/**
 * Honest hub pack count labels — never invent numbers.
 * Prefer live `result.total` and Strong/Good band splits when scored hits exist.
 * Packs without a live query yet omit the count (or show loading), never mock "24 jobs".
 */
import { matchBand, type MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import { isCanadaDeckJob } from "@/lib/jobs/for-you/canada-deck";
import {
    HUB_PACK_IDS,
    jobMatchesHubPack,
    type HubPackId,
} from "@/lib/jobs/for-you/hub-pack-filters";

export type HubCountSource =
    | { kind: "loading" }
    | { kind: "omit" }
    | { kind: "total"; total: number }
    | { kind: "bands"; strong: number; good: number; total?: number; pool?: number };

export type ScoredHubHit = { job: PublicJob; score: MatchScore };

/** Progressive probe page sizes — early partial counts, then climb. */
export const HUB_PROBE_LIMITS = [24, 48, 80, 120] as const;

/** Format a hub pill — empty string means "render no count". */
export function formatHubCountLabel(source: HubCountSource): string {
    if (source.kind === "omit") return "";
    if (source.kind === "loading") return "Matches loading";
    if (source.kind === "total") {
        if (!Number.isFinite(source.total) || source.total < 0) return "";
        const n = Math.floor(source.total);
        return n === 1 ? "1 match" : `${n.toLocaleString()} matches`;
    }
    const { strong, good, total, pool } = source;
    const s = Math.max(0, Math.floor(strong));
    const g = Math.max(0, Math.floor(good));
    if (s > 0 || g > 0) {
        const parts: string[] = [];
        if (s > 0) parts.push(`${s} Strong`);
        if (g > 0) parts.push(`${g} Good`);
        if (pool != null && Number.isFinite(pool) && pool > 0) {
            parts.push(`~${Math.floor(pool).toLocaleString()} pool`);
        }
        return parts.join(" · ");
    }
    if (total != null && Number.isFinite(total) && total >= 0) {
        return formatHubCountLabel({ kind: "total", total });
    }
    if (pool != null && Number.isFinite(pool) && pool > 0) {
        return `~${Math.floor(pool).toLocaleString()} pool`;
    }
    return "";
}

/** Quiet hero line under Welcome — corpus total climbing with the probe. */
export function formatHubCorpusLine(pool: number | null | undefined, probing: boolean): string {
    if (pool == null || !Number.isFinite(pool) || pool < 0) {
        return probing ? "Matching…" : "";
    }
    const n = Math.floor(pool);
    if (n <= 0) return probing ? "Matching…" : "";
    const base = `~${n.toLocaleString()} matches ranked Strong first`;
    return probing ? `${base} · Matching…` : base;
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
    pool?: number | null;
}): HubCountSource {
    if (input.scores) {
        const bands = countFitBands(input.scores);
        if (bands.strong + bands.good + bands.stretch > 0) {
            return {
                kind: "bands",
                strong: bands.strong,
                good: bands.good,
                total: input.total ?? undefined,
                pool: input.pool ?? input.total ?? undefined,
            };
        }
    }
    if (input.total != null && Number.isFinite(input.total) && input.total >= 0) {
        return { kind: "total", total: input.total };
    }
    if (input.pool != null && Number.isFinite(input.pool) && input.pool >= 0) {
        return { kind: "total", total: input.pool };
    }
    if (input.loading) return { kind: "loading" };
    return { kind: "omit" };
}

/**
 * Resolve honest count sources for every hub pack from scored probe hits.
 * While still probing with no scores yet → loading; empty after settle → omit.
 */
export function resolveAllPackHubCounts(input: {
    loading: boolean;
    probing: boolean;
    poolTotal: number | null | undefined;
    scored: ScoredHubHit[];
    nowMs?: number;
}): Record<HubPackId, HubCountSource> {
    const nowMs = input.nowMs ?? Date.now();
    const out = {} as Record<HubPackId, HubCountSource>;
    const pending = input.loading || (input.probing && input.scored.length === 0);

    for (const packId of HUB_PACK_IDS) {
        if (pending) {
            out[packId] = { kind: "loading" };
            continue;
        }
        const packScores = input.scored
            .filter((h) => jobMatchesHubPack(h.job, packId, nowMs))
            .map((h) => h.score);
        if (packId === "all") {
            out[packId] = resolveAllMatchesHubCount({
                loading: false,
                total: input.poolTotal,
                scores: packScores,
                pool: input.poolTotal,
            });
            continue;
        }
        const bands = countFitBands(packScores);
        if (bands.strong + bands.good > 0) {
            out[packId] = {
                kind: "bands",
                strong: bands.strong,
                good: bands.good,
            };
        } else if (bands.stretch > 0) {
            out[packId] = { kind: "total", total: bands.stretch };
        } else if (input.probing) {
            out[packId] = { kind: "loading" };
        } else {
            out[packId] = { kind: "omit" };
        }
    }
    return out;
}

/** Band totals suitable for localStorage memory / removal diffs. */
export function packBandTotalsFromSources(
    sources: Partial<Record<HubPackId, HubCountSource>>,
): Partial<Record<HubPackId, { strong: number; good: number }>> {
    const out: Partial<Record<HubPackId, { strong: number; good: number }>> = {};
    for (const packId of HUB_PACK_IDS) {
        const src = sources[packId];
        if (!src) continue;
        if (src.kind === "bands") {
            out[packId] = { strong: src.strong, good: src.good };
        } else if (src.kind === "total") {
            out[packId] = { strong: 0, good: Math.floor(src.total) };
        }
    }
    return out;
}

/** Card pill — a job count, same noun as the jobs-page result line. */
export function formatHubRoleCount(total: number): string {
    if (!Number.isFinite(total) || total < 0) return "";
    const n = Math.floor(total);
    return n === 1 ? "1 role" : `${n.toLocaleString()} roles`;
}

/**
 * Visible count for every hub category.
 * "All" uses the search total. Other packs count non-Canada jobs in the
 * probe. Canada roles stay out of the per-pack numbers.
 * Before the probe has a total, every card shows an ellipsis so the count
 * slot does not disappear.
 */
export function resolveHubRoleCountLabels(input: {
    loading: boolean;
    probing: boolean;
    poolTotal: number | null | undefined;
    scored: ScoredHubHit[];
    nowMs?: number;
}): Partial<Record<string, string>> {
    const nowMs = input.nowMs ?? Date.now();
    const kept = input.scored.filter((hit) => !isCanadaDeckJob(hit.job));
    const pool =
        input.poolTotal != null && Number.isFinite(input.poolTotal) && input.poolTotal >= 0
            ? Math.floor(input.poolTotal)
            : null;
    const settled = !input.loading && !input.probing && (pool != null || input.scored.length > 0);
    const labels: Partial<Record<string, string>> = {};

    for (const packId of HUB_PACK_IDS) {
        if (packId === "all" && pool != null) {
            labels[packId] = formatHubRoleCount(pool);
            continue;
        }
        if (!settled) {
            labels[packId] = "…";
            continue;
        }
        const n =
            packId === "all"
                ? kept.length
                : kept.filter((hit) => jobMatchesHubPack(hit.job, packId, nowMs)).length;
        labels[packId] = formatHubRoleCount(n);
    }
    return labels;
}

export function formatAllPackHubLabels(
    sources: Partial<Record<HubPackId, HubCountSource>>,
): Partial<Record<string, string>> {
    const labels: Partial<Record<string, string>> = {};
    for (const packId of HUB_PACK_IDS) {
        const src = sources[packId];
        if (!src) continue;
        const label = formatHubCountLabel(src);
        if (label) labels[packId] = label;
    }
    return labels;
}
