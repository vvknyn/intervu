import { LOCATION_UNKNOWN_TEXT, meaningfulTitleTokens, prettyEnum, salaryText } from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import type { PublicJob } from "@/lib/jobs/types";
import { presentJob } from "@/lib/presentation";
import type { ResumeData } from "@/types/resume";

function uniqueOverlap(a: string[], b: string[]): string[] {
    const setB = new Set(b.map((token) => token.toLowerCase()));
    return [...new Set(a.filter((token) => setB.has(token.toLowerCase())))];
}

/** The résumé role whose title shares ≥2 meaningful words with the posting title, or null. */
export function deckOverlapTitle(job: PublicJob, resume: ResumeData | null): string | null {
    const jobTitle = job.title?.trim();
    if (!resume || !jobTitle) return null;
    const jobTokens = meaningfulTitleTokens(jobTitle);
    if (jobTokens.length < 2) return null;

    const candidates = [
        ...resume.experience.map((item) => item.role).filter(Boolean),
        resume.profile?.profession,
    ].filter((value): value is string => Boolean(value?.trim()));

    let best: { title: string; hits: number } | null = null;
    for (const candidate of candidates) {
        const tokens = meaningfulTitleTokens(candidate);
        if (tokens.length < 2) continue;
        const hits = uniqueOverlap(jobTokens, tokens);
        if (hits.length < 2) continue;
        if (!best || hits.length > best.hits) best = { title: candidate.trim(), hits: hits.length };
    }
    return best ? best.title : null;
}

/**
 * One sentence under the title when a résumé role actually overlaps the
 * posting title. Term-count and country are not an overlap — those return null.
 */
export function deckOverlapSentence(job: PublicJob, resume: ResumeData | null): string | null {
    const title = deckOverlapTitle(job, resume);
    return title ? `Overlaps your ${title} experience.` : null;
}

/** Present facts only — no empty labeled rows. Order matches the decision header. */
export function deckFactParts(job: PublicJob, postedRelative: string | null): string[] {
    const presented = presentJob(job);
    const parts: string[] = [];
    if (presented.location && presented.location !== LOCATION_UNKNOWN_TEXT) {
        parts.push(presented.location);
    }
    const workplace = prettyEnum(job.work_type);
    if (workplace) parts.push(workplace);
    const type = prettyEnum(job.employment_type);
    if (type) parts.push(type);
    const seniority = prettyEnum(job.experience_level);
    if (seniority) parts.push(seniority);
    const pay = salaryText(job);
    if (pay) parts.push(pay);
    if (postedRelative) parts.push(`Posted ${postedRelative}`);
    return parts;
}

/** The relist tell is one quiet word. The date essay stays off this surface. */
export function deckRelistedWord(job: PublicJob, nowMs: number): string | null {
    const mark = rowExceptionMark(job, nowMs);
    if (!mark) return null;
    if (mark.kind === "relisted" || mark.kind === "both") return "Relisted";
    return null;
}
