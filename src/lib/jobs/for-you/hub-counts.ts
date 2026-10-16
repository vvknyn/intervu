/**
 * Honest hub pack count labels — never invent numbers.
 * Prefer live `result.total` and Strong/Good band splits when scored hits exist.
 * Packs without a live query yet omit the count (or show loading), never mock "24 jobs".
 */
import { labelNamesPlace, matchBand, type MatchScore } from "@/lib/match/score";
import { deckListFor, withListRemovals, type DeckLeftOutSummary } from "@/lib/jobs/for-you/band-order";
import { collapseByEmployer } from "@/lib/jobs/for-you/employer-slot";
import { listCandidates, readRows } from "@/lib/jobs/for-you/list-rows";
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

/**
 * The pack's list as its deck would open it from these scored rows, and what it left out: the rows read with each opening
 * once, minus the roles whose apply link no longer works and the ones already in the person's tracker (`listCandidates`),
 * then the deck's own rule and fallbacks (`deckListFor`). A chip counts `jobs`, so it cannot promise roles the deck leaves
 * out, and the welcome line's left-out reasons are the deck foot's. `found` is what the search said it found, when that is
 * more than the rows read. `employers` is how many cards the deck makes of `jobs`: it gives each employer one (`collapseByEmployer`).
 */
export function hubList(
    scored: readonly ScoredHubHit[],
    nowMs: number,
    options: { isTracked?: (job: PublicJob) => boolean; found?: number | null } = {},
): { jobs: PublicJob[]; employers: number; summary: DeckLeftOutSummary } {
    const scoreById = new Map(scored.map((hit) => [hit.job.id, hit.score] as const));
    const { candidates, closed, tracked } = listCandidates(readRows(scored.map((hit) => hit.job)), options.isTracked);
    const { ranked, summary } = deckListFor(candidates, (job) => scoreById.get(job.id) ?? null, nowMs);
    return { jobs: ranked, employers: collapseByEmployer(ranked, (job) => job).length, summary: withListRemovals(summary, { closed, tracked }, options.found) };
}

/**
 * Progressive probe page sizes — early partial counts, then climb. The last step is the deck's first page
 * (`FOR_YOU_POOL_WINDOW`), so the roles a tile counts are the ones the deck opens with.
 */
export const HUB_PROBE_LIMITS = [24, 48, 80, 150] as const;

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
