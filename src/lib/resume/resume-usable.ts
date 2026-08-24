import { buildMatchQuery } from "@/lib/jobs/resume-match";
import type { ResumeData } from "@/types/resume";

/**
 * A résumé is "usable" for matching iff `buildMatchQuery` would produce a
 * non-empty query — expressed directly in terms of that function's output,
 * rather than a parallel "has a profession or a skill" check, so the "usable"
 * gate and the query builder cannot drift apart the way they did before (a
 * skills-only résumé used to pass this gate while `buildMatchQuery` returned
 * `q: ""`, so "Ranked by your résumé" silently fell back to an unranked
 * newest-first browse of the whole corpus). Single source of truth: /jobs
 * (`page.tsx`) reads it client-side off local `resume` state, and the
 * `hasUsableResumeOnFile` server action (`actions/resume.ts`) reads it
 * server-side off the persisted document — both import this one function.
 */
export function resumeIsUsable(d: ResumeData | undefined): boolean {
    if (!d) return false;
    return Boolean(buildMatchQuery(d).q);
}
