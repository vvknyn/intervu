/**
 * `TailoredVersionDetail` → `ResumeData` — the one conversion, reused by
 * both the tailored-version PDF download (`TailoredVersionsList.tsx`) and
 * the on-screen `?v=` view (`app/resume/page.tsx`). Lives outside
 * `actions/tailor-resume.ts` because that file starts with `"use server"`,
 * which requires every export to be an async function — this is a plain
 * pure mapper, so it can't live there.
 *
 * Profile/education are always the ORIGINAL halves (A2 rule 3: never sent
 * to the model, never tailored); summary/experience/competencies are the
 * tailored halves.
 */

import type { TailoredVersionDetail } from "@/actions/tailor-resume";
import type { ResumeData } from "@/types/resume";

export function tailoredVersionToResumeData(detail: TailoredVersionDetail): ResumeData {
    return {
        profile: detail.originalProfile,
        education: detail.originalEducation,
        generatedSummary: detail.tailoredSummary,
        experience: detail.tailoredExperience,
        competencies: detail.tailoredCompetencies,
        sectionOrder: detail.sectionOrder,
    };
}
