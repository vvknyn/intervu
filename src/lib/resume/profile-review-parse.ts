/**
 * Shared résumé upload quality gate for every upload surface.
 *
 * `File.text()` on an uncompressed PDF returns the content stream (BT/ET,
 * Tf/Td, /F2) as if it were résumé text. The rules parser then treats those
 * operators as Core Skills and the review screen says the parse succeeded.
 * Flow 29: that false success must not be offered for save.
 */

import {
    extractDocxTextInBrowser,
    extractPDFTextInBrowser,
} from "@/lib/local-ai/extract-in-browser";
import { parseResumeLocally, type ParseResumeLocallyOptions } from "@/lib/local-ai/parse-resume";
import type { ResumeData } from "@/types/resume";

/** Shown when extraction or structure checks refuse the Parsed on-device review. */
export const PROFILE_REVIEW_UNREADABLE_ERROR =
    "Could not read a résumé from this file. Try another PDF or DOCX, or paste your résumé text instead.";

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

function flattenSkills(parsed: ResumeData): string[] {
    return parsed.competencies?.flatMap((category) => category.skills.filter(Boolean)) ?? [];
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

export function hasMeaningfulResumeIdentity(parsed: ResumeData): boolean {
    const profile = parsed.profile;
    const skills = flattenSkills(parsed).filter((skill) => !OPERATOR_SKILL_RE.test(skill.trim()));
    return Boolean(
        profile.name?.trim() ||
            profile.profession?.trim() ||
            skills.length >= 1,
    );
}

export function refuseResumeReview(parsed: ResumeData, rawText?: string): string | null {
    if (rawText && textLooksLikePdfContentStream(rawText)) {
        return PROFILE_REVIEW_UNREADABLE_ERROR;
    }
    const skills = flattenSkills(parsed);
    if (skillsIncludePdfOperators(skills) || isBlankProfileReview(parsed) || !hasMeaningfulResumeIdentity(parsed)) {
        return PROFILE_REVIEW_UNREADABLE_ERROR;
    }
    return null;
}

export function coreSkillsString(parsed: ResumeData): string {
    return flattenSkills(parsed).join(", ");
}

export type ProfileReviewParse =
    | { ok: true; parsed: ResumeData; skillsString: string }
    | { ok: false; error: string };

async function parseExtractedTextForReview(
    text: string,
    options: ParseResumeLocallyOptions = {},
): Promise<ProfileReviewParse> {
    if (textLooksLikePdfContentStream(text)) {
        return { ok: false, error: PROFILE_REVIEW_UNREADABLE_ERROR };
    }

    let parsed: ResumeData;
    try {
        const result = await parseResumeLocally(text, options);
        parsed = result.data.parsed;
    } catch (error) {
        const message = error instanceof Error ? error.message : PROFILE_REVIEW_UNREADABLE_ERROR;
        return { ok: false, error: message };
    }

    const refusal = refuseResumeReview(parsed, text);
    if (refusal) {
        return { ok: false, error: refusal };
    }

    return { ok: true, parsed, skillsString: coreSkillsString(parsed) };
}

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
    return parseExtractedTextForReview(extracted.text, options);
}

export async function parseResumeFileForReview(
    file: File,
    options: ParseResumeLocallyOptions = {},
): Promise<ProfileReviewParse> {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (extension === "txt" || extension === "md") {
        const text = (await file.text()).trim();
        if (!text) {
            return { ok: false, error: PROFILE_REVIEW_UNREADABLE_ERROR };
        }
        return parseExtractedTextForReview(text, options);
    }

    if (extension !== "pdf" && extension !== "docx" && extension !== "doc") {
        return {
            ok: false,
            error: "Unsupported file type. Please use .txt, .md, .pdf, or .docx.",
        };
    }

    const buffer = await file.arrayBuffer();
    const extracted =
        extension === "pdf"
            ? await extractPDFTextInBrowser(buffer)
            : await extractDocxTextInBrowser(buffer);

    if (extracted.error || !extracted.text) {
        return {
            ok: false,
            error: extracted.error || PROFILE_REVIEW_UNREADABLE_ERROR,
        };
    }

    return parseExtractedTextForReview(extracted.text, options);
}
