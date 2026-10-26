import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { postedAgeShort } from "@/lib/jobs/presentation";
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

/** The two row facts the list row has no other place for; each is `null`/`false` unless true for this row. */
export interface RowSourceFacts {
    /** When Velai first saw a newly listed role, e.g. "1d ago"; `null` unless the row is "fresh" and its own age does not already say it. */
    firstSeen: string | null;
    fromEmployerSite: boolean;
}

export function rowSourceFacts(job: Pick<PublicJob, "source" | "posted_at" | "first_seen_at">, nowMs: number): RowSourceFacts {
    const { kind, firstSeenMs, postedMs } = classifyPostingFreshness(job, nowMs);
    const seen = kind === "fresh" ? postedAgeShort(firstSeenMs, nowMs) : null;
    // The row's right rail already prints this age (posted, or first seen when the posting has no date): never twice.
    const railAge = postedAgeShort(postedMs ?? firstSeenMs, nowMs);
    return { firstSeen: seen !== railAge ? seen : null, fromEmployerSite: isEmployerSiteSource(job.source) };
}
