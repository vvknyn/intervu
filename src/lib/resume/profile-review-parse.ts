/**
 * Profile-review gate for the onboarding PDF upload.
 *
 * `File.text()` on an uncompressed PDF returns the content stream (BT/ET,
 * Tf/Td, /F2) as if it were résumé text. The rules parser then treats those
 * operators as Core Skills and the review screen says the parse succeeded.
 * Flow 29: that false success must not be offered for save.
 */

import { extractPDFTextInBrowser } from "@/lib/local-ai/extract-in-browser";
import { parseResumeLocally, type ParseResumeLocallyOptions } from "@/lib/local-ai/parse-resume";
import type { ResumeData } from "@/types/resume";

/** Shown instead of the review when the PDF did not yield a real profile. */
export const PROFILE_REVIEW_UNREADABLE_ERROR =
    "Could not read résumé text from this PDF. Please try another file.";

/** A single content-stream token, or a font-select operand (`/F2`). */
const OPERATOR_TOKEN_RE = /^(?:ET|BT|Tf|Td|TL|Tj|TJ|Tm)$|^\/F\d+$/;

/** One skill chip that is itself a drawing command, not a skill phrase. */
const OPERATOR_SKILL_RE = /^(?:ET|BT)$|\b(?:Tf|Td|TL)\b|\/F\d+/;

export function textLooksLikePdfContentStream(text: string): boolean {
    const tokens = text.split(/[\s,]+/).filter(Boolean);
    let hits = 0;
    for (const token of tokens) {
        if (OPERATOR_TOKEN_RE.test(token)) hits += 1;
    }
    return hits >= 4;
}

export function skillsIncludePdfOperators(skills: string[]): boolean {
    return skills.some((skill) => OPERATOR_SKILL_RE.test(skill.trim()));
}

/** Name, title, and location empty, with years left at the unset default. */
export function isBlankProfileReview(parsed: ResumeData): boolean {
    const profile = parsed.profile;
    return (
        !profile.name?.trim() &&
        !profile.profession?.trim() &&
        !profile.location?.trim() &&
        (profile.yearsOfExperience ?? 0) === 0
    );
}

export function coreSkillsString(parsed: ResumeData): string {
    const skills = parsed.competencies?.flatMap((category) => category.skills) ?? [];
    return skills.join(", ");
}

export type ProfileReviewParse =
    | { ok: true; parsed: ResumeData; skillsString: string }
    | { ok: false; error: string };

/**
 * Extract a PDF and decide whether the onboarding review may show
 * “Parsed on-device” and offer save. Operator text and an empty profile
 * both refuse that screen.
 */
export async function parsePdfForProfileReview(
    buffer: ArrayBuffer,
    options: ParseResumeLocallyOptions = {},
): Promise<ProfileReviewParse> {
    const extracted = await extractPDFTextInBrowser(buffer);
    if (extracted.error || !extracted.text) {
        return {
            ok: false,
            error: extracted.error || PROFILE_REVIEW_UNREADABLE_ERROR,
        };
    }
    if (textLooksLikePdfContentStream(extracted.text)) {
        return { ok: false, error: PROFILE_REVIEW_UNREADABLE_ERROR };
    }

    let parsed: ResumeData;
    try {
        const result = await parseResumeLocally(extracted.text, options);
        parsed = result.data.parsed;
    } catch (error) {
        const message = error instanceof Error ? error.message : PROFILE_REVIEW_UNREADABLE_ERROR;
        return { ok: false, error: message };
    }

    const skills = parsed.competencies?.flatMap((category) => category.skills) ?? [];
    if (skillsIncludePdfOperators(skills) || isBlankProfileReview(parsed)) {
        return { ok: false, error: PROFILE_REVIEW_UNREADABLE_ERROR };
    }

    return { ok: true, parsed, skillsString: skills.join(", ") };
}
