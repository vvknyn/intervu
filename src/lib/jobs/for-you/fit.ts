/**
 * The ONE place `scoreJobAgainstResume` (match/score.ts) and `inferReasons`
 * (infer-reasons.ts, this directory) are composed together. Every surface
 * that attaches BOTH a job's match score and its fit reasons —
 * `toJobDetailFields` (agent/tools.ts, backing search_jobs and get_job) and
 * `rankForYou` (ranked.ts, backing the for_you MCP tool) — calls this,
 * never the two scoring functions directly, so the pairing can't drift
 * between surfaces. (`ForYouPack.tsx`, the only pre-existing pairing site,
 * is off-limits — a parallel PR owns that component right now — so this is
 * a fresh chokepoint rather than a redirect of that one.)
 *
 * Returns `null` whenever there's no résumé, or `scoreJobAgainstResume`
 * itself found nothing comparable (its own null) — `fit_reasons` is never
 * attached to a job with no `match`, the same "omit, never fabricate"
 * convention `toJobDetailFields` already applies to `match` alone. Pure, no
 * I/O — same isomorphic convention as its two inputs.
 */
import type { CandidateSignals } from "@/lib/jobs/candidate-signals";
import { scoreJobAgainstResume, type MatchScore } from "@/lib/match/score";
import { inferReasons, type InferReasonsResult } from "@/lib/jobs/for-you/infer-reasons";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export interface Fit {
    match: MatchScore;
    fit_reasons: InferReasonsResult;
}

export function fitFor(resume: ResumeData | null, job: PublicJob, signals?: CandidateSignals): Fit | null {
    const match = resume ? scoreJobAgainstResume(resume, job, signals) : null;
    if (!match) return null;
    return { match, fit_reasons: inferReasons(job, match, resume) };
}
