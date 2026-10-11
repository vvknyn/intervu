import { relevanceTerms, termAsWritten } from "./score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

/** The terms the fit label counts (the role's title and tags), split by whether the résumé has them, as the job writes them. */
export interface FitTerms {
    matched: string[];
    missing: string[];
}

/**
 * Pure: the fit label's terms for ✓/✗ chips, or null when the role names
 * none. The same terms and wording the extension's card shows
 * (extension/src/card-summary.ts) and the MCP tools name, from the same
 * `relevanceTerms` and `termAsWritten`, so they all read alike.
 */
export function fitTerms(resume: ResumeData, job: PublicJob): FitTerms | null {
    const { matched, missing } = relevanceTerms(resume, job);
    if (!matched.length && !missing.length) return null;
    return { matched: matched.map((t) => termAsWritten(t, job)), missing: missing.map((t) => termAsWritten(t, job)) };
}
