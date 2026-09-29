/**
 * Corpus-scale Meilisearch counts for hub pack pills — same live-vacancy +
 * hide-ghosts + places baseline as `getCachedDefaultBrowse`, not the fit
 * probe's 30d window or browse page hits.
 *
 * Query-string `OR` is not a disjunction on this index: the token is dropped,
 * `matchingStrategy: "all"` then requires every remaining word (0 hits), and
 * `"last"` keeps only the first word. Keyword packs count each haystack
 * phrase on its own and publish the largest as a floor.
 */
import { resolveCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { keywordPackLowerBound } from "@/lib/jobs/for-you/hub-counts";
import {
    buildSearchBody,
    host,
    JOBS_INDEX,
    meiliFetch,
    searchKey,
} from "@/lib/jobs/meilisearch";
import type { FacetDistribution, JobSearchParams, JobSearchResult, PlaceClause } from "@/lib/jobs/types";
import { HUB_PACK_IDS, type HubPackId } from "@/lib/jobs/for-you/hub-pack-filters";

const HAS_SALARY_FILTER =
    "(salary_min > 0 OR salary_max > 0 OR normalized_salary_min > 0 OR normalized_salary_max > 0)";

/** `isLeadJob` experience_level branch. Title regex is not filterable (CONTAINS is off). */
const LEAD_EXPERIENCE_FILTER =
    '(experience_level = "lead" OR experience_level = "principal" OR experience_level = "staff" OR experience_level = "director")'; // unknown-inclusive-exempt: the Lead pack is a topic (lead-level roles), not a candidate seniority filter

/** Quoted phrases from `AI_RE`. `occupation` is not a searchableAttribute. */
const AI_PACK_QUERIES = [
    '"artificial intelligence"',
    '"ai"',
    '"machine learning"',
    '"ml"',
    '"deep learning"',
    '"llm"',
    '"large language"',
    '"generative ai"',
    '"neural"',
    '"nlp"',
    '"computer vision"',
    '"transformer"',
    '"pytorch"',
    '"tensorflow"',
] as const;

/** Quoted phrases from `GOOD_RE`. Prefix `sustainab` is the two whole words it matches. */
const GOOD_PACK_QUERIES = [
    '"nonprofit"',
    '"non-profit"',
    '"not-for-profit"',
    '"climate"',
    '"sustainability"',
    '"sustainable"',
    '"social impact"',
    '"tech for good"',
    '"civic"',
    '"public interest"',
    '"clean energy"',
    '"renewable"',
    '"education equity"',
    '"healthcare access"',
    '"conservation"',
    '"humanitarian"',
    '"mission-driven"',
    '"mission driven"',
] as const;

const HAYSTACK_ATTRIBUTES = ["title", "tags", "company"] as const;

function baseBrowseParams(places: PlaceClause[] | undefined): JobSearchParams {
    return {
        hideGhosts: true,
        places,
        limit: 0,
        offset: 0,
        withFacets: true,
        sort: "newest",
    };
}

function extraFiltersForPack(packId: HubPackId): string[] {
    if (packId === "all") return [];
    const extra: string[] = [];
    if (packId === "salary") extra.push(`(${HAS_SALARY_FILTER})`);
    if (packId === "lead") extra.push(LEAD_EXPERIENCE_FILTER);
    return extra;
}

function packSearchParams(packId: HubPackId, places: PlaceClause[] | undefined): JobSearchParams {
    const base = baseBrowseParams(places);
    switch (packId) {
        case "all":
            return base;
        case "remote":
            return { ...base, facets: { work_type: ["remote"] } };
        case "fresh":
            return { ...base, postedBucket: "7d" };
        case "salary":
        case "lead":
        case "ai":
        case "good":
            return base;
        case "apply":
            // apply_url is not filterable. Changing filterableAttributes reindexes;
            // do not. The public document copies the listing URL into apply_url,
            // and a 5,000-row sample of recent live listings had no empty URL
            // (2026-09-28), so this pill is the live corpus.
            return base;
        default:
            return base;
    }
}

function packSearchBody(
    packId: HubPackId,
    places: PlaceClause[] | undefined,
    legacy: boolean,
    q?: string,
) {
    const params = packSearchParams(packId, places);
    const body = buildSearchBody(q ? { ...params, q } : params, legacy, "all", {});
    const extra = extraFiltersForPack(packId);
    if (extra.length) body.filter = [...body.filter, ...extra];
    if (q) {
        // Already-quoted phrases. Do not re-quote: `quoteShortTokens` would
        // turn a query-string OR into a required word and zero the count.
        body.q = q;
        body.attributesToSearchOn = [...HAYSTACK_ATTRIBUTES];
    }
    return { params, body };
}

async function postHubPackCorpusSearch(
    packId: HubPackId,
    places: PlaceClause[] | undefined,
    q?: string,
): Promise<JobSearchResult | null> {
    const h = host();
    if (!h) return null;

    const run = async (legacy: boolean) => {
        const { body } = packSearchBody(packId, places, legacy, q);
        return meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
            cache: "no-store",
            body: JSON.stringify(body),
        });
    };

    let res = await run(false);
    if (!res.ok && res.status === 400) {
        const text = await res.text().catch(() => "");
        const { params } = packSearchBody(packId, places, false, q);
        if (/posted_ts/i.test(text) && params.postedBucket) {
            res = await run(true);
        } else {
            return null;
        }
    }
    if (!res.ok) return null;

    const body = (await res.json()) as {
        estimatedTotalHits?: number;
        totalHits?: number;
        facetDistribution?: FacetDistribution;
    };
    const total = body.totalHits ?? body.estimatedTotalHits ?? 0;
    return {
        hits: [],
        total,
        backend: "meilisearch",
        configured: true,
        facetDistribution: body.facetDistribution,
    };
}

async function fetchKeywordPackCount(
    packId: "ai" | "good",
    places: PlaceClause[] | undefined,
    queries: readonly string[],
): Promise<CorpusCount | null> {
    const counts = await Promise.all(
        queries.map(async (q) => {
            const result = await postHubPackCorpusSearch(packId, places, q);
            return result ? resolveCorpusCount(result) : null;
        }),
    );
    return keywordPackLowerBound(counts);
}

export async function fetchHubPackCorpusCount(
    packId: HubPackId,
    places: PlaceClause[] | undefined,
): Promise<CorpusCount | null> {
    if (packId === "ai") return fetchKeywordPackCount(packId, places, AI_PACK_QUERIES);
    if (packId === "good") return fetchKeywordPackCount(packId, places, GOOD_PACK_QUERIES);

    const result = await postHubPackCorpusSearch(packId, places);
    if (!result) return null;
    const count = resolveCorpusCount(result);
    // Title matches ("Director of…", "head of") sit outside the experience_level
    // filter. The level count is a floor for the pack, not the whole pack.
    if (packId === "lead" && count.kind === "exact") {
        return { kind: "floor", value: count.value };
    }
    return count;
}

export type HubPackCorpusCounts = Partial<Record<HubPackId, CorpusCount | null>>;

export async function fetchAllHubPackCorpusCounts(
    places: PlaceClause[] | undefined,
): Promise<HubPackCorpusCounts> {
    const entries = await Promise.all(
        HUB_PACK_IDS.map(async (packId) => [packId, await fetchHubPackCorpusCount(packId, places)] as const),
    );
    return Object.fromEntries(entries);
}
