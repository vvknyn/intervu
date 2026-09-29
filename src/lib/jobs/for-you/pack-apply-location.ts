/**
 * Candidate city/region for pack apply.
 *
 * Keeps the city/region that is actually on the résumé on the apply payload
 * and the résumé that gets tailored. It does not invent a place. The
 * search-side location filter comes from the one signals resolver
 * (candidate-signals.ts), the same for every country.
 */
import { candidateLocationFromResume, type LocationResume } from "@/lib/jobs/candidate-signals";
import type { ResumeData } from "@/types/resume";

export { candidateLocationFromResume };

export interface PackApplyPayload {
    /** Sanitized city/region from the résumé. Null when the résumé has none. */
    candidateLocation: string | null;
}

export function buildPackApplyPayload(resume: LocationResume | null | undefined): PackApplyPayload {
    const location = candidateLocationFromResume(resume);
    return { candidateLocation: location || null };
}

/** Résumé handed to tailored pack apply, with the candidate place filled in when one exists. */
export function resumeForPackApply(resume: ResumeData): ResumeData {
    const location = buildPackApplyPayload(resume).candidateLocation ?? "";
    if ((resume.profile.location ?? "") === location) return resume;
    return {
        ...resume,
        profile: {
            ...resume.profile,
            location,
        },
    };
}
