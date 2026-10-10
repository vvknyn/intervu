import { relevanceTerms } from "./score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

/** The terms the fit label counts (the role's title and tags), split by whether the résumé has them, as the job writes them. */
export interface FitTerms {
    matched: string[];
    missing: string[];
}

/** Pure: a matching term ("icu") as the job writes it ("ICU"). */
export function asWritten(term: string, job: PublicJob): string {
    const words = [job.title, ...(job.tags ?? [])].join(" ").split(/[^\p{L}\p{N}+#.]+/u);
    return words.find((word) => word.toLowerCase() === term) ?? term;
}

/**
 * Pure: the fit label's terms for ✓/✗ chips, or null when the role names
 * none. The same terms and wording the extension's card shows
 * (extension/src/card-summary.ts `fitTerms`), from the same
 * `relevanceTerms`, so the site and the extension read alike.
 */
export function fitTerms(resume: ResumeData, job: PublicJob): FitTerms | null {
    const { matched, missing } = relevanceTerms(resume, job);
    if (!matched.length && !missing.length) return null;
    return { matched: matched.map((t) => asWritten(t, job)), missing: missing.map((t) => asWritten(t, job)) };
}
