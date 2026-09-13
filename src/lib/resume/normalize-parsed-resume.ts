/**
 * Shared sanitization for cloud-LLM and local parse paths.
 *
 * Keeps years-of-experience honest: computed from parsed date ranges in code,
 * never blindly trusted from a model or heuristic guess.
 */

import { sanitizeLocation } from "@/lib/resume/contact-line";
import { descriptionToBullets } from "@/lib/resume/merge-bullet-lines";
import { computeYearsOfExperience } from "@/lib/resume/years-of-experience";
import type {
    ParsedResumeResult,
    ResumeConfidenceScores,
    ResumeData,
    ResumeEducation,
    ResumeExperience,
    UncertainField,
} from "@/types/resume";

/** Loose shape from LLM JSON or local structurer before normalization. */
export interface RawParsedResumeInput {
    profile?: {
        name?: string;
        profession?: string;
        yearsOfExperience?: number;
        location?: string;
        email?: string;
        phone?: string;
        linkedin?: string;
        website?: string;
    };
    experience?: Array<{
        id?: string;
        company?: string;
        role?: string;
        dates?: string;
        description?: string;
    }>;
    projects?: Array<{
        id?: string;
        company?: string;
        role?: string;
        dates?: string;
        description?: string;
    }>;
    competencies?: Array<{ category?: string; skills?: string[] }>;
    education?: Array<{ id?: string; degree?: string; institution?: string; year?: string }>;
    generatedSummary?: string;
    summary?: string;
    professionalSummary?: string;
}

export interface NormalizeParsedResumeOptions {
    confidence?: Partial<ResumeConfidenceScores>;
    uncertainFields?: UncertainField[];
    warnings?: string[];
    /** When true, skip the "AI had difficulty" warning (local rules path). */
    localRules?: boolean;
}

/** Converts literal `\n` strings and run-together bullets into real newlines. */
export function normalizeDescription(desc: string): string {
    if (!desc) return "";

    let normalized = desc.replace(/\\n/g, "\n");
    normalized = normalized.replace(/([^\n])([•\-\*])\s/g, "$1\n$2 ");
    normalized = normalized.replace(/\n{3,}/g, "\n\n").trim();

    const bullets = descriptionToBullets(normalized);
    if (bullets.length === 0) return normalized;
    return bullets.map((b) => `• ${b}`).join("\n");
}

/**
 * Validate, sanitize, and compute derived fields on parsed résumé JSON.
 * Used by both `parseResumeWithAI` (server) and `parseResumeLocally` (client).
 */
export function normalizeParsedResume(
    raw: RawParsedResumeInput,
    options: NormalizeParsedResumeOptions = {},
): ParsedResumeResult {
    const experience: ResumeExperience[] = Array.isArray(raw.experience)
        ? raw.experience.map((exp, idx) => ({
              id: exp.id || `exp-${idx + 1}`,
              company: exp.company || "",
              role: exp.role || "",
              dates: exp.dates || "",
              description: normalizeDescription(exp.description || ""),
          }))
        : [];

    const computedYoE = computeYearsOfExperience(experience, new Date());
    const yearsOfExperience =
        computedYoE !== null ? computedYoE : Number(raw.profile?.yearsOfExperience) || 0;

    const parsed: ResumeData = {
        profile: {
            name: raw.profile?.name || "",
            profession: raw.profile?.profession || "",
            yearsOfExperience,
            location: sanitizeLocation(raw.profile?.location),
            email: raw.profile?.email || "",
            phone: raw.profile?.phone || "",
            linkedin: raw.profile?.linkedin || "",
            website: raw.profile?.website || "",
        },
        experience,
        projects: Array.isArray(raw.projects)
            ? raw.projects.map((exp, idx) => ({
                  id: exp.id || `proj-${idx + 1}`,
                  company: exp.company || "",
                  role: exp.role || "",
                  dates: exp.dates || "",
                  description: normalizeDescription(exp.description || ""),
              }))
            : undefined,
        competencies: Array.isArray(raw.competencies)
            ? raw.competencies.map((comp) => ({
                  category: comp.category || "Skills",
                  skills: Array.isArray(comp.skills) ? comp.skills : [],
              }))
            : [],
        education: Array.isArray(raw.education)
            ? raw.education.map((edu, idx) => ({
                  id: edu.id || `edu-${idx + 1}`,
                  degree: edu.degree || "",
                  institution: edu.institution || "",
                  year: edu.year || "",
              }))
            : [],
        generatedSummary: (raw.generatedSummary || raw.summary || raw.professionalSummary || "")
            .replace(/\\n/g, "\n")
            .trim(),
    };

    const confidence: ResumeConfidenceScores = {
        overall: options.confidence?.overall ?? 70,
        profile: options.confidence?.profile ?? 70,
        experience: options.confidence?.experience ?? 70,
        competencies: options.confidence?.competencies ?? 70,
        education: options.confidence?.education ?? 70,
        summary: options.confidence?.summary ?? 70,
    };

    const uncertainFields: UncertainField[] = Array.isArray(options.uncertainFields)
        ? options.uncertainFields
        : [];

    const warnings: string[] = Array.isArray(options.warnings) ? [...options.warnings] : [];

    if (!options.localRules) {
        if (confidence.overall < 70) {
            warnings.unshift(
                "The AI had difficulty parsing your resume. Please review all sections carefully.",
            );
        }
        if (confidence.experience < 70) {
            warnings.push(
                "Some work experience entries may have parsing errors. Please verify dates and descriptions.",
            );
        }
        if (confidence.competencies < 70) {
            warnings.push("Skills were found but could not be categorized automatically.");
        }
    } else if (confidence.overall < 75) {
        warnings.unshift(
            "Parsed with on-device rules — please review all sections before saving.",
        );
    }

    return { parsed, confidence, uncertainFields, warnings };
}
