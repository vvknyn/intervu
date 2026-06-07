/**
 * Shared chokepoint for applying accepted tailoring recommendations to a resume.
 *
 * Two call sites used to each carry their own (buggy) copy of this logic:
 *   - src/app/resume-tailor/page.tsx  (saved ORIGINAL values — recs were lost entirely)
 *   - src/app/applications/page.tsx   (used exact `includes()` / `===` — silently no-op'd
 *                                      whenever the AI's `original` string didn't byte-match
 *                                      the resume text, which is the common case because the
 *                                      model rewrites/normalizes whitespace & punctuation).
 *
 * This module is the single source of truth. It applies a recommendation by
 * NORMALIZED, then FUZZY, matching so a near-match rewrite still lands instead of
 * being dropped. Pure functions only — no React, no I/O — so it is unit-testable.
 */

import type {
    ResumeData,
    ResumeExperience,
    ResumeCompetencyCategory,
    TailoringRecommendation,
} from "@/types/resume";

export interface TailoredResumeFields {
    tailoredSummary: string;
    tailoredExperience: ResumeExperience[];
    tailoredCompetencies: ResumeCompetencyCategory[];
}

/**
 * Collapse whitespace, strip zero-width chars, and lowercase so that two strings
 * that differ only in formatting (the LLM's `original` vs the stored resume text)
 * compare equal. This is the comparison key — NOT what we store.
 */
export function normalizeForMatch(s: string): string {
    return s
        .replace(/[​-‍﻿]/g, "") // zero-width chars
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/**
 * Replace `original` with `suggested` inside `haystack`, tolerant of whitespace /
 * smart-quote / case differences. Returns the original haystack unchanged if no
 * acceptable match is found (so a bad rec can never corrupt resume text).
 *
 * Match strategy, in order:
 *  1. Exact substring (fast path, preserves surrounding text byte-for-byte).
 *  2. Normalized substring: rebuild a regex from `original` where every run of
 *     whitespace matches `\s+`, so differing indentation/newlines still match.
 *  3. Whole-field fuzzy equality: if the entire field equals `original` after
 *     normalization, replace the whole field. Covers single-bullet / single-line
 *     fields the regex would miss due to anchoring.
 */
export function fuzzyReplace(haystack: string, original: string, suggested: string): string {
    if (!original) return haystack;

    // 1. Exact
    if (haystack.includes(original)) {
        return haystack.replace(original, suggested);
    }

    // 2. Normalized substring via whitespace-flexible regex.
    const escaped = original
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex metachars
        .replace(/\s+/g, "\\s+"); // any whitespace run matches any whitespace run
    try {
        const re = new RegExp(escaped, "i");
        if (re.test(haystack)) {
            return haystack.replace(re, suggested);
        }
    } catch {
        /* malformed regex — fall through to whole-field check */
    }

    // 3. Whole-field fuzzy equality.
    if (normalizeForMatch(haystack) === normalizeForMatch(original)) {
        return suggested;
    }

    return haystack;
}

/**
 * Apply the set of accepted recommendations to a resume, producing the tailored
 * summary / experience / competencies. Input data is never mutated.
 *
 * - `summary`     recs replace the whole summary with `suggested`.
 * - `experience`  recs fuzzy-replace inside each experience `description`.
 * - `skills`      recs fuzzy-replace a matching skill OR a competency `category`.
 * - `overall`     recs are strategic notes only — nothing to apply to fields.
 */
export function applyRecommendations(
    resume: ResumeData,
    accepted: TailoringRecommendation[],
): TailoredResumeFields {
    let tailoredSummary = resume.generatedSummary;
    const tailoredExperience: ResumeExperience[] = resume.experience.map((e) => ({ ...e }));
    const tailoredCompetencies: ResumeCompetencyCategory[] = resume.competencies.map((c) => ({
        ...c,
        skills: [...c.skills],
    }));

    for (const rec of accepted) {
        if (!rec.suggested) continue;

        if (rec.category === "summary") {
            tailoredSummary = rec.suggested;
        } else if (rec.category === "experience" && rec.original) {
            for (const exp of tailoredExperience) {
                exp.description = fuzzyReplace(exp.description, rec.original, rec.suggested);
            }
        } else if (rec.category === "skills" && rec.original) {
            const normOriginal = normalizeForMatch(rec.original);
            for (const comp of tailoredCompetencies) {
                const skillIdx = comp.skills.findIndex(
                    (s) => normalizeForMatch(s) === normOriginal,
                );
                if (skillIdx !== -1) {
                    comp.skills[skillIdx] = rec.suggested;
                }
                if (normalizeForMatch(comp.category) === normOriginal) {
                    comp.category = rec.suggested;
                }
            }
        }
        // 'overall' recs are advisory — no field to apply.
    }

    return { tailoredSummary, tailoredExperience, tailoredCompetencies };
}
