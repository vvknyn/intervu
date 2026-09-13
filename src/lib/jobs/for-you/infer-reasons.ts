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

    if (score) {
        for (const component of score.components) {
            if (bullets.length >= MAX_BULLETS) break;
            if (component.key === "relevance" && component.score >= 0.35) {
                bullets.push(component.detail);
            } else if (component.key === "seniority" && component.score >= 0.5) {
                bullets.push(component.detail);
            } else if (component.key === "location" && component.score >= 0.5) {
                bullets.push(component.detail);
            }
        }
    }

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

    if (bullets.length === 0 && score) {
        bullets.push("Limited overlap we could compare — review the role details below.");
    } else if (bullets.length === 0) {
        bullets.push("Add or refresh your résumé to see more specific match reasons.");
    }

    return {
        bullets: bullets.slice(0, MAX_BULLETS),
        chips: [...new Set(chips)].slice(0, MAX_CHIPS),
    };
}
