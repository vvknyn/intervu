/**
 * Pure local-parse confidence scoring — no client parse imports.
 * Used by parseResumeLocally and ResumeImportModal review gating.
 */

import type { RawParsedResumeInput } from "@/lib/resume/normalize-parsed-resume";
import type { ResumeConfidenceScores, ResumeData } from "@/types/resume";

/** Minimum overall score (inclusive) to accept local parse on review. */
export const LOCAL_PARSE_ACCEPT_MIN = 91;

export type LocalParseConfidenceInput = RawParsedResumeInput | ResumeData;

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function clampConfidence(score: number): number {
    return Math.max(0, Math.min(99, Math.round(score)));
}

function flattenSkills(data: LocalParseConfidenceInput): string[] {
    const competencies = data.competencies;
    if (!Array.isArray(competencies)) return [];
    return competencies.flatMap((entry) =>
        Array.isArray(entry.skills) ? entry.skills.filter((s) => isNonEmptyString(s)) : [],
    );
}

function hasExperienceEntry(data: LocalParseConfidenceInput): boolean {
    const experience = data.experience;
    if (!Array.isArray(experience)) return false;
    return experience.some(
        (entry) => isNonEmptyString(entry.company) || isNonEmptyString(entry.role),
    );
}

function isRichExperience(entry: { company?: string; role?: string; dates?: string }): boolean {
    return (
        isNonEmptyString(entry.company) &&
        isNonEmptyString(entry.role) &&
        isNonEmptyString(entry.dates)
    );
}

function hasRichExperience(data: LocalParseConfidenceInput): boolean {
    const experience = data.experience;
    if (!Array.isArray(experience)) return false;
    return experience.some(isRichExperience);
}

function experienceEntryCount(data: LocalParseConfidenceInput): number {
    const experience = data.experience;
    if (!Array.isArray(experience)) return 0;
    return experience.filter(
        (entry) => isNonEmptyString(entry.company) || isNonEmptyString(entry.role),
    ).length;
}

function hasEducation(data: LocalParseConfidenceInput): boolean {
    const education = data.education;
    if (!Array.isArray(education)) return false;
    return education.some(
        (entry) => isNonEmptyString(entry.degree) || isNonEmptyString(entry.institution),
    );
}

function getSummary(data: LocalParseConfidenceInput): string {
    if ("generatedSummary" in data && isNonEmptyString(data.generatedSummary)) {
        return data.generatedSummary.trim();
    }
    const raw = data as RawParsedResumeInput;
    const candidate = raw.generatedSummary || raw.summary || raw.professionalSummary || "";
    return typeof candidate === "string" ? candidate.trim() : "";
}

function scoreProfileSection(data: LocalParseConfidenceInput): number {
    const profile = data.profile ?? {};
    let score = 0;
    if (isNonEmptyString(profile.name)) score += 38;
    if (isNonEmptyString(profile.profession)) score += 38;
    if (isNonEmptyString(profile.email)) score += 23;
    return clampConfidence(score);
}

function scoreExperienceSection(data: LocalParseConfidenceInput): number {
    const count = experienceEntryCount(data);
    if (count === 0) return 0;
    if (hasRichExperience(data)) {
        return clampConfidence(count >= 2 ? 94 : 92);
    }
    return 75;
}

function scoreCompetenciesSection(data: LocalParseConfidenceInput): number {
    const skills = flattenSkills(data);
    if (skills.length === 0) return 0;
    if (skills.length >= 3) return 94;
    return 78;
}

function scoreEducationSection(data: LocalParseConfidenceInput): number {
    return hasEducation(data) ? 92 : 0;
}

function scoreSummarySection(data: LocalParseConfidenceInput): number {
    const summary = getSummary(data);
    return summary.length > 20 ? 92 : 0;
}

/**
 * Score overall and per-section confidence from parsed résumé fields.
 * Overall is the sum of signal points (not a hardcoded constant), clamped 0–99.
 */
export function scoreLocalParseConfidence(data: LocalParseConfidenceInput): ResumeConfidenceScores {
    const profile = data.profile ?? {};
    let overall = 0;

    if (isNonEmptyString(profile.name)) overall += 18;
    if (isNonEmptyString(profile.profession)) overall += 18;

    const expCount = experienceEntryCount(data);
    if (expCount >= 1) overall += 20;
    if (hasRichExperience(data)) overall += 8;
    if (expCount >= 2) overall += 4;

    const skills = flattenSkills(data);
    if (skills.length >= 1) overall += 14;
    if (skills.length >= 3) overall += 4;

    if (isNonEmptyString(profile.email)) overall += 10;
    if (hasEducation(data)) overall += 6;

    if (getSummary(data).length > 20) overall += 4;

    return {
        overall: clampConfidence(overall),
        profile: scoreProfileSection(data),
        experience: scoreExperienceSection(data),
        competencies: scoreCompetenciesSection(data),
        education: scoreEducationSection(data),
        summary: scoreSummarySection(data),
    };
}

export function canAcceptLocalParse(confidence: ResumeConfidenceScores | number): boolean {
    const overall = typeof confidence === "number" ? confidence : confidence.overall;
    return overall >= LOCAL_PARSE_ACCEPT_MIN;
}
