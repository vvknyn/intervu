import { meaningfulTitleTokens } from "@/lib/jobs/presentation";
import type { MatchScore } from "@/lib/match/score";
import { topSkills } from "@/lib/jobs/resume-match";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export interface InferReasonsResult {
    bullets: string[];
    chips: string[];
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

    const work = job.work_type?.replace(/_/g, " ");
    if (work && chips.length < MAX_CHIPS) chips.push(work);

    if (score) {
        // Only fall back to "limited overlap" when the breakdown itself has nothing
        // strong to show either — otherwise this bullet would contradict a decent
        // score sitting right above it. No detail text is repeated here (see note
        // above); this only asks whether qualifying evidence exists.
        const hasQualifyingComponent = score.components.some(
            (component) =>
                (component.key === "relevance" && component.score >= 0.35) ||
                (component.key === "seniority" && component.score >= 0.5) ||
                (component.key === "location" && component.score >= 0.5),
        );
        if (bullets.length === 0 && !hasQualifyingComponent) {
            bullets.push("Limited overlap we could compare — review the role details below.");
        }
    } else if (bullets.length === 0) {
        bullets.push("Add or refresh your résumé to see more specific match reasons.");
    }

    return {
        bullets: bullets.slice(0, MAX_BULLETS),
        chips: [...new Set(chips)].slice(0, MAX_CHIPS),
    };
}
