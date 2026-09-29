import { meaningfulTitleTokens } from "@/lib/jobs/presentation";
import type { MatchScore } from "@/lib/match/score";
import { topSkills } from "@/lib/jobs/resume-match";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export interface InferReasonsResult {
    bullets: string[];
    chips: string[];
}

export type NoScoreReason = "no-resume" | "no-description";

/**
 * Single source for the copy shown wherever a row has no fit score at all
 * (`matchScore === null`) — the Fit header/breakdown in ForYouPack AND the
 * bullets fallback below both read from this instead of each writing its
 * own guess at why the score is missing.
 */
export const NO_SCORE_MESSAGES: Record<NoScoreReason, string> = {
    "no-resume": "Add résumé text to see fit",
    "no-description": "No description captured for this posting yet",
};

/**
 * Why a row has no fit score: `scoreJobAgainstResume` (score.ts) returns
 * null exactly when either the job's or the résumé's vocabulary is empty.
 * `resumeIsUsable` is the existing single source of truth for "does this
 * résumé have any matchable text" — when it's usable, a null score can only
 * mean the job side had nothing to compare (no description/tags/title
 * tokens), never a résumé problem.
 */
export function noScoreReason(resume: ResumeData | null): NoScoreReason {
    return resumeIsUsable(resume ?? undefined) ? "no-description" : "no-resume";
}

const MAX_BULLETS = 3;
const MAX_CHIPS = 4;

function tokenOverlap(a: string[], b: string[]): string[] {
    const setB = new Set(b.map((t) => t.toLowerCase()));
    return [...new Set(a.filter((t) => setB.has(t.toLowerCase())))].slice(0, 4);
}

function jobTags(job: PublicJob): string[] {
    return (job.tags ?? []).map((t) => t.trim()).filter(Boolean);
}

export function inferReasons(
    job: PublicJob,
    score: MatchScore | null,
    resume: ResumeData | null,
): InferReasonsResult {
    const bullets: string[] = [];
    const chips: string[] = [];

    // When a matchScore exists, ForYouPack renders every score.components[].detail
    // verbatim in the Fit breakdown. Bullets must never restate that text — do not
    // re-add a component-detail-sourced bullet here; it would always duplicate the
    // breakdown by construction (the breakdown shows all components, unfiltered).
    // Bullets below carry only evidence the breakdown does not already state.

    // Chips (like bullets) must carry only résumé∩job evidence — a job-only
    // fact (e.g. its own work_type) is not something we inferred, it's
    // already stated verbatim elsewhere on the card (the stated chips row,
    // "The position"), and presenting it here reads as a match reason even
    // when the résumé has no overlap with it at all. Do not add a job-only
    // field as a chip; every push below must be gated on an overlap with
    // `resume`.

    if (resume) {
        const titleTokens = meaningfulTitleTokens(job.title ?? "");
        const resumeTitles = resume.experience.map((e) => e.role).filter(Boolean);
        const resumeTitleTokens = resumeTitles.flatMap((t) => meaningfulTitleTokens(t));
        const titleHits = tokenOverlap(titleTokens, resumeTitleTokens);
        if (titleHits.length > 0 && bullets.length < MAX_BULLETS) {
            bullets.push(`Title overlap with your experience (${titleHits.slice(0, 3).join(", ")})`);
        }

        const skills = topSkills(resume, 12);
        const tagHits = tokenOverlap(skills, jobTags(job));
        for (const hit of tagHits) {
            if (chips.length >= MAX_CHIPS) break;
            chips.push(hit);
        }

        if (resume.profile?.profession && job.title) {
            const profTokens = meaningfulTitleTokens(resume.profile.profession);
            const overlap = tokenOverlap(profTokens, titleTokens);
            if (overlap.length > 0 && chips.length < MAX_CHIPS) {
                chips.push(resume.profile.profession);
            }
        }
    }

    if (score) {
        // Only fall back to "limited overlap" when the breakdown itself has nothing
        // strong to show either — otherwise this bullet would contradict a decent
        // score sitting right above it. No detail text is repeated here (see note
        // above); this only asks whether qualifying evidence exists.
        const hasQualifyingComponent = score.components.some(
            (component) =>
                !component.unknown &&
                ((component.key === "relevance" && component.score >= 0.35) ||
                    (component.key === "seniority" && component.score >= 0.5) ||
                    (component.key === "location" && component.score >= 0.5)),
        );
        if (bullets.length === 0 && !hasQualifyingComponent) {
            bullets.push("Limited overlap we could compare — review the role details below.");
        }
    } else if (bullets.length === 0) {
        bullets.push(NO_SCORE_MESSAGES[noScoreReason(resume)]);
    }

    return {
        bullets: bullets.slice(0, MAX_BULLETS),
        chips: [...new Set(chips)].slice(0, MAX_CHIPS),
    };
}
