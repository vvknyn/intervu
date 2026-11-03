import { LOCATION_UNKNOWN_TEXT, prettyEnum, salaryText } from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import type { PublicJob } from "@/lib/jobs/types";
import { presentJob } from "@/lib/presentation";
import { resumeLanguages } from "@/lib/match/posting-language";
import { sharedMeaningfulPhrases, sharedRoleHeads, titleInResumeLanguage, titlesShareSignal } from "@/lib/match/title-signal";
import type { ResumeData } from "@/types/resume";

/**
 * The résumé role this posting's title actually overlaps: a shared role head
 * ("product", "nurse") or a meaningful phrase ("product manager"). Generic
 * modifiers alone ("technical", "manager") are not an overlap.
 */
export function deckOverlapTitle(job: PublicJob, resume: ResumeData | null): string | null {
    const raw = job.title?.trim();
    if (!resume || !raw) return null;
    const jobTitle = titleInResumeLanguage(raw, resumeLanguages(resume) ?? ["english"]);

    const candidates = [
        ...resume.experience.map((item) => item.role).filter(Boolean),
        resume.profile?.profession,
    ].filter((value): value is string => Boolean(value?.trim()));

    let best: { title: string; rank: number } | null = null;
    for (const candidate of candidates) {
        if (!titlesShareSignal(jobTitle, candidate)) continue;
        const rank = sharedRoleHeads(jobTitle, candidate).length * 10 + sharedMeaningfulPhrases(jobTitle, candidate).length;
        if (!best || rank > best.rank) best = { title: candidate.trim(), rank };
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
