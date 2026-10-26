import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * True when the pipeline recorded this role as read from the employer's own careers page or ATS: its
 * `job_listings.source` carries the `_direct` adapter label (`greenhouse_direct`, `careers_direct`,
 * `html_direct`, …). Mirrors the suffix branch of the pipeline's own classifier, `isDirectAtsSource`
 * (subspace packages/core/src/domains/domain-registry.ts:184) — one rule, not a list of board names.
 * An empty or unrecognised source is not a claim either way.
 */
export function isEmployerSiteSource(source: string | null | undefined): boolean {
    return !!source && source.includes("_direct");
}

/** The two row marks the list row prints as squared hairline chips; each is `false` unless true for this row. */
export interface RowSourceFacts {
    /** "New": the shared 7-day `classifyPostingFreshness` rule, the same one `listNewSince` reads. */
    isNew: boolean;
    fromEmployerSite: boolean;
}

export function rowSourceFacts(job: Pick<PublicJob, "source" | "posted_at" | "first_seen_at">, nowMs: number): RowSourceFacts {
    return { isNew: classifyPostingFreshness(job, nowMs).kind === "fresh", fromEmployerSite: isEmployerSiteSource(job.source) };
}
