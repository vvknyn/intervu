/**
 * Requirement and duty terms for a résumé-ranked list's rows, read from their
 * descriptions on the server (`jdTermsFromDescription`, match/jd-match.ts).
 *
 * A list row carries no description (`JOB_LIST_ATTRIBUTES_TO_RETRIEVE`), so
 * the fit score used to read titles and tags only. This attaches each row's
 * `jd_terms` — a few dozen phrases, ~1 KB a row instead of the ~6 KB
 * description — so the browser can score the WHOLE posting against the résumé
 * it holds. Only the job's own text is read here: the résumé never comes to
 * the server for this, the same split as `withPlaceRestrictions`
 * (place-notes.ts), whose shape this follows: one bounded read per page, a
 * process cache, and on a slow or failed read the rows come back as they
 * were (scored on title and tags, as before).
 */
import { descriptionNeedsFill } from "./fill-description";
import { buildJobSearchUrl } from "./get-job";
import { host, meiliFetch, searchKey } from "./meilisearch";
import { jdTermsFromDescription, type JdSourceJob, type JdTerms } from "../match/jd-match";
import type { PublicJob } from "./types";

/** How long a résumé-ranked search waits for its rows' terms before it answers without them. */
export const SEARCH_JD_READ_DEADLINE_MS = 900;
/** A typed search by someone holding a résumé (`JobSearchParams.jdTerms`): the place read's own budget (`SEARCH_PLACE_READ_DEADLINE_MS`), so it is no slower. */
export const SEARCH_JD_TYPED_READ_DEADLINE_MS = 250;
/** The most rows one search reads (a pack's first page and the hub's deepest probe, `FOR_YOU_READ_DEPTH`). */
export const SEARCH_JD_READ_MAX_IDS = 300;
/**
 * Rows per read. A deeper page reads its rows in parts, one after the other, each within the deadline: its first 150
 * get their terms exactly as a page of 150 did, and a part that misses its deadline leaves the parts after it unread.
 */
export const SEARCH_JD_READ_PART = 150;

const JD_CACHE_MAX = 20_000;
const JD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const jdCache = new Map<string, { terms: JdTerms | null; at: number }>();

function cachedTerms(id: string, now: number): JdTerms | null | undefined {
    const hit = jdCache.get(id);
    if (!hit) return undefined;
    if (now - hit.at > JD_CACHE_TTL_MS) {
        jdCache.delete(id);
        return undefined;
    }
    return hit.terms;
}

function keepTerms(id: string, terms: JdTerms | null, now: number) {
    jdCache.delete(id);
    jdCache.set(id, { terms, at: now });
    if (jdCache.size > JD_CACHE_MAX) jdCache.delete(jdCache.keys().next().value!);
}

export function resetJdTermsCacheForTests(): void {
    jdCache.clear();
}

/** Terms for `ids`, from the cache or one Meili read. A description still waiting to be filled is read but not cached. */
export async function readJdTerms(ids: string[], signal?: AbortSignal): Promise<Record<string, JdTerms | null>> {
    const now = Date.now();
    const out: Record<string, JdTerms | null> = {};
    const unread: string[] = [];
    for (const id of new Set(ids)) {
        const cached = cachedTerms(id, now);
        if (cached === undefined) unread.push(id);
        else out[id] = cached;
    }
    const h = host();
    if (unread.length === 0 || !h) return out;

    const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
        body: JSON.stringify({
            q: "",
            filter: `id IN [${unread.map((id) => JSON.stringify(id)).join(", ")}]`,
            limit: unread.length,
            attributesToRetrieve: ["id", "title", "description", "company", "location", "must_have_skills", "skills_section_found"],
        }),
        cache: "no-store",
    };
    const url = buildJobSearchUrl(h);
    const res = signal ? await fetch(url, { ...init, signal }) : await meiliFetch(url, init);
    if (!res.ok) throw new Error(`meili jd terms read failed: ${res.status}`);
    const body = (await res.json()) as { hits?: (JdSourceJob & { id: string; description?: string | null })[] };
    for (const hit of body.hits ?? []) {
        out[hit.id] = jdTermsFromDescription(hit.description, hit);
        if (!descriptionNeedsFill(hit.description)) keepTerms(hit.id, out[hit.id]!, now);
    }
    return out;
}

/**
 * A résumé-ranked search's rows, each carrying its description's terms
 * (`jd_terms`). Read in parts of `SEARCH_JD_READ_PART` rows, each bounded by
 * `deadlineMs`: past it that part's rows and the ones after it come back as
 * they were, and its read still finishes in the background so the next search
 * for those rows is warm.
 */
export async function withJdTerms<T extends PublicJob>(
    hits: T[],
    {
        read = readJdTerms,
        deadlineMs = SEARCH_JD_READ_DEADLINE_MS,
    }: { read?: (ids: string[], signal: AbortSignal) => Promise<Record<string, JdTerms | null>>; deadlineMs?: number } = {},
): Promise<T[]> {
    const ids = hits.filter((hit) => hit.jd_terms === undefined).slice(0, SEARCH_JD_READ_MAX_IDS).map((hit) => hit.id);
    if (ids.length === 0) return hits;
    const terms: Record<string, JdTerms | null> = {};
    for (let start = 0; start < ids.length; start += SEARCH_JD_READ_PART) {
        const part = await readPart(ids.slice(start, start + SEARCH_JD_READ_PART), read, deadlineMs);
        if (!part) break;
        Object.assign(terms, part);
    }
    return hits.map((hit) => (hit.id in terms ? { ...hit, jd_terms: terms[hit.id] ?? null } : hit));
}

/** One part's terms, or `null` when its read failed or missed `deadlineMs`. */
async function readPart(
    ids: string[],
    read: (ids: string[], signal: AbortSignal) => Promise<Record<string, JdTerms | null>>,
    deadlineMs: number,
): Promise<Record<string, JdTerms | null> | null> {
    const controller = new AbortController();
    const reading = read(ids, controller.signal).catch(() => null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadlineMs);
    });
    return Promise.race([reading, late]).finally(() => clearTimeout(timer));
}
