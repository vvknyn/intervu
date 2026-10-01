/**
 * "More like this" (JobDetail — Curiosity / Serial Positioning Effect): the
 * reader's next stop after a posting. `getRelatedJobsAction`
 * (actions/jobs.ts) does the fetching; this file holds the pure decisions
 * around it — what to search for, which list to show, and what to call it.
 *
 * Similar roles come FIRST: this job's title keywords, in this job's
 * country. The company's own other roles are the fallback, not the lead —
 * the panel links "All jobs at {brand}" right above this list, so leading
 * with the same company repeated that link and showed a Product Manager a
 * Product Designer and a GTM Lead under a heading that promised roles
 * "like this" (Vivek, 2026-09-30).
 */

import type { PublicJob } from "@/lib/jobs/types";

/**
 * Below this many hits a pass isn't a real list — one other role reads as a
 * coincidence, not a set of alternatives — so the caller tries the
 * company's own roles instead.
 */
export const MIN_RELATED_HITS = 2;

/** How many leading significant words the title query keeps. */
const MAX_TITLE_WORDS = 3;

/**
 * Seniority/qualifier and function words stripped before a title becomes a
 * search query — they narrow toward exact-title matches (or match nothing
 * at all) rather than the adjacent roles this list is for. Kept short and
 * title-specific rather than a general-purpose stopword list: the only
 * failure mode this guards is a title that's ALL qualifier words
 * (`relatedTitleQuery`'s null), not general search quality.
 */
const TITLE_NOISE_WORDS = new Set([
    "senior", "sr", "jr", "junior", "staff", "principal", "lead", "head",
    "i", "ii", "iii", "iv", "v",
    "the", "a", "an", "and", "or", "of", "for", "to", "in", "at", "on", "with",
]);

/** First `max` significant words in `title` — lowercased, noise-stripped, in
 *  reading order. Exported for its own direct test coverage alongside
 *  `relatedTitleQuery`. */
export function significantTitleWords(title: string, max: number = MAX_TITLE_WORDS): string[] {
    return (title ?? "")
        .toLowerCase()
        .split(/[^a-z0-9+]+/)
        .filter((w) => w.length > 1 && !TITLE_NOISE_WORDS.has(w))
        .slice(0, max);
}

/**
 * The role itself, without the team, product or shift after a comma, a
 * spaced dash, a bar or a bracket: "UX Designer, Chrome Disco" is a UX
 * Designer. Taking the first three words of the whole title searched for
 * "ux designer chrome" and surfaced a Chrome product manager (2026-09-30).
 * An unspaced hyphen stays ("Front-End Developer").
 */
export function titleCore(title: string): string {
    const core = (title ?? "").split(/,|\(|\[|\||\s[-–—/]\s/)[0]!.trim();
    return core || (title ?? "").trim();
}

/** The similar-roles query for `title`, or null when the title has no usable
 *  keywords (e.g. "Senior Staff Lead") — an empty query would search the
 *  whole corpus, which is not "related". */
export function relatedTitleQuery(title: string): string | null {
    const words = significantTitleWords(titleCore(title));
    const all = words.length > 0 ? words : significantTitleWords(title);
    return all.length > 0 ? all.join(" ") : null;
}

/** The one country to keep similar roles in, or null (no country, or a
 *  multi-country posting — no single place to scope to). */
export function relatedCountry(country: PublicJob["location_country"]): string | null {
    const one = Array.isArray(country) ? (country.length === 1 ? country[0] : null) : country;
    return one?.trim() || null;
}

/**
 * What "More like this" is built from: the viewed job's id, title, company
 * and place, as plain strings, so it crosses the server-action boundary
 * without the description and can key the fetch effect.
 */
export interface RelatedSeed {
    id: string;
    title: string;
    company: string | null;
    companyDomain: string | null;
    location: string | null;
    state: string | null;
    /** One country value (`relatedCountry`), or null. */
    country: string | null;
}

export function relatedSeed(
    job: Pick<PublicJob, "id" | "title" | "company" | "company_domain" | "location" | "location_state" | "location_country">,
): RelatedSeed {
    const text = (v: string | null | undefined) => v?.trim() || null;
    return {
        id: job.id,
        title: job.title ?? "",
        company: text(job.company),
        companyDomain: text(job.company_domain),
        location: text(job.location),
        state: text(job.location_state),
        country: relatedCountry(job.location_country),
    };
}

/** Which list "More like this" is showing — decides its heading. */
export type RelatedBasis = "title" | "company";

/**
 * Similar roles when there are enough of them; otherwise the company's own
 * other roles when it has any; otherwise whatever similar roles came back.
 */
export function pickRelatedJobs<T>(input: { titleHits: T[]; companyHits: T[] }): { jobs: T[]; basis: RelatedBasis } {
    if (input.titleHits.length >= MIN_RELATED_HITS) return { jobs: input.titleHits, basis: "title" };
    if (input.companyHits.length > 0) return { jobs: input.companyHits, basis: "company" };
    return { jobs: input.titleHits, basis: "title" };
}

/** The list's heading. A company-only list says so, rather than claiming a
 *  designer is "like" a product manager because they share an employer. */
export function relatedJobsHeading(basis: RelatedBasis, companyBrand: string | null | undefined): string {
    if (basis === "title") return "More like this";
    const brand = companyBrand?.trim();
    return brand ? `More at ${brand}` : "More at this company";
}

type DedupableJob = Pick<PublicJob, "id" | "title" | "company" | "location" | "posted_ts">;

/** Normalised title+company+location — the "same row, re-scraped or
 *  cross-posted" key for `dedupeRelatedJobs`. Location is part of the key:
 *  the same title at the same company but a different location is a
 *  genuinely different opening, not a duplicate. */
function relatedDedupeKey(job: Pick<DedupableJob, "title" | "company" | "location">): string {
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
    return `${norm(job.title)}|${norm(job.company)}|${norm(job.location)}`;
}

/**
 * "More like this" row list, ready to render: excludes the job currently
 * being viewed and its twins (another row with its title, company and
 * location: the same opening posted twice, which read as the job listing
 * itself), then collapses rows that share a normalised
 * title+company+location (the same opening cross-posted or re-scraped into
 * more than one row) down to one, keeping the newest `posted_ts`. Rows that
 * only share title+company — a different location — are different openings
 * and are both kept.
 */
export function dedupeRelatedJobs<T extends DedupableJob>(
    jobs: T[],
    current: string | Pick<RelatedSeed, "id" | "title" | "company" | "location">,
): T[] {
    const currentId = typeof current === "string" ? current : current.id;
    const currentKey = typeof current === "string" ? null : relatedDedupeKey(current);
    const byKey = new Map<string, T>();
    for (const job of jobs) {
        if (job.id === currentId) continue;
        const key = relatedDedupeKey(job);
        if (key === currentKey) continue;
        const existing = byKey.get(key);
        if (!existing || (job.posted_ts ?? 0) > (existing.posted_ts ?? 0)) {
            byKey.set(key, job);
        }
    }
    return Array.from(byKey.values());
}
