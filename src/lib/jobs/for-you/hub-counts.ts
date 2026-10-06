/**
 * Honest hub pack count labels — never invent numbers.
 * Prefer live `result.total` and Strong/Good band splits when scored hits exist.
 * Packs without a live query yet omit the count (or show loading), never mock "24 jobs".
 */
import { labelNamesPlace, matchBand, type MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { CorpusCount } from "@/lib/jobs/corpus-count";
import {
    HUB_PACK_IDS,
    jobMatchesHubPack,
    type HubPackId,
} from "@/lib/jobs/for-you/hub-pack-filters";

/** Hub pack pill placeholder while corpus counts are in flight. */
export const HUB_PACK_CORPUS_COUNT_LOADING = "…";

export type HubCountSource =
    | { kind: "loading" }
    | { kind: "omit" }
    | { kind: "total"; total: number }
    | { kind: "bands"; strong: number; good: number; total?: number; pool?: number };

export type ScoredHubHit = { job: PublicJob; score: MatchScore };

/** Progressive probe page sizes — early partial counts, then climb. */
export const HUB_PROBE_LIMITS = [24, 48, 80, 120] as const;

/**
 * How long a finished hub probe (and its tile counts) stays good for the same résumé and pack.
 * Going back to the hub repaints it instead of re-sending every search, which spent the
 * per-visitor search limit and left the next pack's counts refused.
 */
export const HUB_PROBE_MEMO_MS = 5 * 60_000;

/** A finished probe to repaint: same résumé and pack, every count known, and recent. */
export function freshHubProbeMemo<T extends { key: string; at: number; complete: boolean }>(
    memo: T | null,
    key: string,
    now: number,
): T | null {
    return memo && memo.complete && memo.key === key && now - memo.at < HUB_PROBE_MEMO_MS ? memo : null;
}

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

/**
 * Hero line for a browse hub — roles in the corpus, no fit bands.
 * Do not say Strong. There is no score yet.
 */
export function formatBrowseHubCorpusLine(pool: number | null | undefined): string {
    if (pool == null || !Number.isFinite(pool) || pool <= 0) return "";
    return `~${Math.floor(pool).toLocaleString()} roles`;
}

export function formatHubCorpusLine(pool: number | null | undefined, probing: boolean): string {
    if (pool == null || !Number.isFinite(pool) || pool < 0) {
        return probing ? "Matching…" : "";
    }
    const n = Math.floor(pool);
    if (n <= 0) return probing ? "Matching…" : "";
    const base = `~${n.toLocaleString()} matches ranked Strong first`;
    return probing ? `${base} · Matching…` : base;
}

/**
 * Count Strong / Good bands from a score map over known job ids. A role whose
 * label names its place instead of a fit ("Outside Canada", "Country
 * unclear") counts with Stretch, so a tile never says Good for it.
 */
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
        const band = labelNamesPlace(score) ? "stretch" : matchBand(score.total);
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
 * Largest phrase count. More than one phrase → a floor, because overlap is
 * unknown: the sum would overstate the pack, and the max is the count we
 * can stand behind ("at least this many"). A single exact count stays exact.
 */
export function keywordPackLowerBound(counts: Array<CorpusCount | null | undefined>): CorpusCount | null {
    const usable = counts.filter((count): count is CorpusCount => {
        if (count == null) return false;
        return Number.isFinite(count.value) && count.value >= 0;
    });
    if (usable.length === 0) return null;
    const max = Math.max(...usable.map((count) => count.value));
    const only = usable[0];
    if (usable.length === 1 && only?.kind === "exact") return { kind: "exact", value: only.value };
    return { kind: "floor", value: max };
}

/**
 * Pack counts for a résumé visitor. Every tile opens the résumé's pack list
 * (`packFilters`), so every tile counts inside that list: "all" is the list's
 * total, each other pack is `jobMatchesHubPack` over the list rows fetched so
 * far. Exact once those rows are the whole list, a floor before that.
 */
export function resumeHubPackCounts(input: {
    listTotal: CorpusCount;
    listJobs: PublicJob[];
    nowMs?: number;
}): Record<HubPackId, CorpusCount> {
    const nowMs = input.nowMs ?? Date.now();
    const whole = input.listTotal.kind === "exact" && input.listJobs.length >= input.listTotal.value;
    const out = {} as Record<HubPackId, CorpusCount>;
    for (const packId of HUB_PACK_IDS) {
        if (packId === "all") {
            out[packId] = input.listTotal;
            continue;
        }
        const value = input.listJobs.filter((job) => jobMatchesHubPack(job, packId, nowMs)).length;
        out[packId] = { kind: whole ? "exact" : "floor", value };
    }
    return out;
}

/** A pack chip's count: the pill without its noun ("96 roles" → "96", "31+ roles" → "31+", "…" stays). */
export function hubChipCountText(label: string): string {
    return label.replace(/\s+roles?$/, "");
}

/**
 * Smallest "at least" count a pack shows. A floor only counts the rows read
 * so far, so "0+" or "1+" reads as a tiny exact number for a pack that may
 * hold many more; below this the pack shows no count instead.
 */
export const HUB_FLOOR_MIN_SHOWN = 10;

/** Role pill from a `CorpusCount` — never from browse page hits. "" when there's no count worth showing. */
export function formatHubPackCorpusRoleLabel(count: CorpusCount | null | undefined): string {
    if (count == null) return HUB_PACK_CORPUS_COUNT_LOADING;
    const n = Math.floor(count.value);
    if (!Number.isFinite(n) || n < 0) return HUB_PACK_CORPUS_COUNT_LOADING;
    if (count.kind === "floor") return n >= HUB_FLOOR_MIN_SHOWN ? `${n.toLocaleString()}+ roles` : "";
    return n === 1 ? "1 role" : `${n.toLocaleString()} roles`;
}

export function formatHubPackCorpusRoleLabels(
    counts: Partial<Record<HubPackId, CorpusCount | null | undefined>>,
    options?: { loading?: boolean },
): Partial<Record<string, string>> {
    const labels: Partial<Record<string, string>> = {};
    for (const packId of HUB_PACK_IDS) {
        if (options?.loading && counts[packId] == null) {
            labels[packId] = HUB_PACK_CORPUS_COUNT_LOADING;
            continue;
        }
        labels[packId] = formatHubPackCorpusRoleLabel(counts[packId]);
    }
    return labels;
}

/**
 * Visible count for every hub category.
 * "All" uses the search total. Other packs count jobs in the
 * probe sample.
 * A partial probe still paints counts — waiting for the last page hid
 * every card on an ellipsis. Before any total or sample exists, the
 * slot stays an ellipsis so it does not disappear.
 */
export function resolveHubRoleCountLabels(input: {
    loading: boolean;
    probing: boolean;
    poolTotal: number | null | undefined;
    scored: ScoredHubHit[];
    nowMs?: number;
}): Partial<Record<string, string>> {
    const nowMs = input.nowMs ?? Date.now();
    const pool =
        input.poolTotal != null && Number.isFinite(input.poolTotal) && input.poolTotal >= 0
            ? Math.floor(input.poolTotal)
            : null;
    const hasSample = input.scored.length > 0;
    const labels: Partial<Record<string, string>> = {};

    for (const packId of HUB_PACK_IDS) {
        if (packId === "all" && pool != null) {
            labels[packId] = formatHubRoleCount(pool);
            continue;
        }
        if (!hasSample) {
            labels[packId] = "…";
            continue;
        }
        const n =
            packId === "all"
                ? input.scored.length
                : input.scored.filter((hit) => jobMatchesHubPack(hit.job, packId, nowMs)).length;
        labels[packId] = formatHubRoleCount(n);
    }
    return labels;
}

/**
 * Pack pills from an unscored browse sample. Used when there is no usable
 * résumé, the résumé is junk that cannot build a fit query, or the résumé
 * fetch has not settled. Counts are role totals from the jobs in hand.
 * They are not Strong/Good bands, and they are not an ellipsis once a
 * sample exists.
 */
export function resolveBrowseHubRoleCountLabels(input: {
    jobs: PublicJob[];
    poolTotal: number | null | undefined;
    nowMs?: number;
}): Partial<Record<string, string>> {
    const nowMs = input.nowMs ?? Date.now();
    const pool =
        input.poolTotal != null && Number.isFinite(input.poolTotal) && input.poolTotal >= 0
            ? Math.floor(input.poolTotal)
            : null;
    const hasSample = input.jobs.length > 0;
    const labels: Partial<Record<string, string>> = {};

    for (const packId of HUB_PACK_IDS) {
        if (packId === "all" && pool != null) {
            labels[packId] = formatHubRoleCount(pool);
            continue;
        }
        if (!hasSample) {
            labels[packId] = "…";
            continue;
        }
        const n =
            packId === "all"
                ? input.jobs.length
                : input.jobs.filter((job) => jobMatchesHubPack(job, packId, nowMs)).length;
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
