/**
 * Client-side résumé parse. The quick read (rules, structure-resume-text.ts)
 * always runs in the browser. When it misses something ranking uses
 * (`modelReadNeeded`), the caller can also ask sealed AI (Tinfoil, see
 * src/lib/sealed-ai/client.ts) to read it: the text goes without the person's
 * name, email, phone or links, encrypted so only Tinfoil's attested server
 * can read it, and the quick read stays whatever the model says.
 */

import { normalizeParsedResume, type RawParsedResumeInput } from "@/lib/resume/normalize-parsed-resume";
import { structureResumeText } from "@/lib/resume/structure-resume-text";
import type { ParsedResumeResult } from "@/types/resume";
import { scoreLocalParseConfidence } from "./parse-confidence";
import { sealedChat } from "@/lib/sealed-ai/client";
import { withoutContactDetails } from "@/lib/resume/without-contact";
import { ENGINE_LABELS, type LocalAiEngineId, type ModelParseOutput } from "./engines/types";

export interface LocalParseResult {
    data: ParsedResumeResult;
    engine: LocalAiEngineId;
    engineLabel: string;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

const PROFILE_STRING_KEYS = [
    "name",
    "profession",
    "location",
    "email",
    "phone",
    "linkedin",
] as const;

function modelOutputToRaw(parsed: Record<string, unknown>): RawParsedResumeInput {
    const profile = (parsed.profile as RawParsedResumeInput["profile"]) ?? {};
    return {
        profile,
        experience: parsed.experience as RawParsedResumeInput["experience"],
        competencies: parsed.competencies as RawParsedResumeInput["competencies"],
        education: parsed.education as RawParsedResumeInput["education"],
        generatedSummary: (parsed.generatedSummary as string) ?? "",
    };
}

function hasMeaningfulExperience(experience: unknown): boolean {
    return (
        Array.isArray(experience) &&
        experience.some(
            (entry) =>
                isNonEmptyString((entry as { company?: string }).company) ||
                isNonEmptyString((entry as { role?: string }).role),
        )
    );
}

function hasMeaningfulCompetencies(competencies: unknown): boolean {
    return (
        Array.isArray(competencies) &&
        competencies.some((entry) => {
            const skills = (entry as { skills?: unknown }).skills;
            return Array.isArray(skills) && skills.some((skill) => isNonEmptyString(skill));
        })
    );
}

function hasMeaningfulEducation(education: unknown): boolean {
    return (
        Array.isArray(education) &&
        education.some(
            (entry) =>
                isNonEmptyString((entry as { degree?: string }).degree) ||
                isNonEmptyString((entry as { institution?: string }).institution),
        )
    );
}

/**
 * Merge model output into heuristic draft without letting empty WASM fields
 * clobber good rule-based extractions.
 */
export function mergeModelIntoHeuristic(
    heuristic: RawParsedResumeInput,
    modelOut: Record<string, unknown> | null,
): { raw: RawParsedResumeInput; usedHeuristic: boolean } {
    if (!modelOut || typeof modelOut !== "object") {
        return { raw: heuristic, usedHeuristic: true };
    }

    const fromModel = modelOutputToRaw(modelOut);
    let modelContributed = false;

    const mergedProfile = { ...(heuristic.profile ?? {}) };
    for (const key of PROFILE_STRING_KEYS) {
        const value = fromModel.profile?.[key];
        if (isNonEmptyString(value)) {
            mergedProfile[key] = value;
            modelContributed = true;
        }
    }
    if (
        typeof fromModel.profile?.yearsOfExperience === "number" &&
        fromModel.profile.yearsOfExperience > 0
    ) {
        mergedProfile.yearsOfExperience = fromModel.profile.yearsOfExperience;
        modelContributed = true;
    }

    const raw: RawParsedResumeInput = {
        profile: mergedProfile,
        experience: heuristic.experience,
        projects: heuristic.projects,
        competencies: heuristic.competencies,
        education: heuristic.education,
        generatedSummary: heuristic.generatedSummary,
        // The model reads content; the layout is the source's own.
        sectionOrder: heuristic.sectionOrder,
        sectionHeadings: heuristic.sectionHeadings,
        additionalSections: heuristic.additionalSections,
        sourceHeader: heuristic.sourceHeader,
    };

    if (hasMeaningfulExperience(fromModel.experience)) {
        raw.experience = fromModel.experience;
        modelContributed = true;
    }
    if (hasMeaningfulCompetencies(fromModel.competencies)) {
        raw.competencies = fromModel.competencies;
        modelContributed = true;
    }
    if (hasMeaningfulEducation(fromModel.education)) {
        raw.education = fromModel.education;
        modelContributed = true;
    }
    if (isNonEmptyString(fromModel.generatedSummary)) {
        raw.generatedSummary = fromModel.generatedSummary;
        modelContributed = true;
    }

    return { raw, usedHeuristic: !modelContributed };
}

/** The most résumé text sent to the model: a long résumé's first pages hold what ranking reads. */
const SEALED_READ_CHARS = 8_000;
/** Reply cap: the entries and lines of a résumé that long, copied out. */
const SEALED_READ_MAX_TOKENS = 3_000;
const SEALED_READ_TIMEOUT_MS = 40_000;

/** The résumé text without what identifies the person: their name, email, phone numbers and links (without-contact.ts). */
export { withoutContactDetails };

function readSealedPrompt(text: string): string {
    return `Read this résumé into JSON. The person's name and contact details were removed.
Copy every word exactly as written; leave out anything the text doesn't say.
Reply with JSON only, in this shape:
{"profile":{"profession":"","yearsOfExperience":0,"location":""},"experience":[{"company":"","role":"","dates":"","description":"• bullet\\n• bullet"}],"competencies":[{"category":"","skills":[""]}],"education":[{"degree":"","institution":"","year":""}]}

"""
${text.slice(0, SEALED_READ_CHARS)}
"""`;
}

function parseModelJson(text: string): ModelParseOutput {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
        const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/** Sealed AI's read of the résumé, or null when it's off or fails. Identity fields stay the quick read's. */
async function readWithSealedAi(content: string, name?: string): Promise<ModelParseOutput> {
    const reply = await sealedChat([{ role: "user", content: readSealedPrompt(withoutContactDetails(content, name)) }], {
        maxTokens: SEALED_READ_MAX_TOKENS,
        temperature: 0,
        timeoutMs: SEALED_READ_TIMEOUT_MS,
    });
    const out = reply ? parseModelJson(reply) : null;
    if (!out) return null;
    // It never saw these: anything it puts there isn't the person's.
    const profile = (out.profile && typeof out.profile === "object" ? out.profile : {}) as Record<string, unknown>;
    delete profile.name;
    delete profile.email;
    delete profile.phone;
    delete profile.linkedin;
    delete profile.website;
    return { ...out, profile };
}

export interface ParseResumeLocallyOptions {
    /**
     * Also ask sealed AI to read it, on top of the quick read: only worth it
     * when the quick read missed something (`modelReadNeeded`).
     */
    withModel?: boolean;
}

/**
 * Parse résumé text: the quick read in this browser, and — when asked and
 * sealed AI is set up — the sealed model's read merged over it.
 */
export async function parseResumeLocally(
    content: string,
    options: ParseResumeLocallyOptions = {},
): Promise<LocalParseResult> {
    if (!content || content.trim().length < 50) {
        throw new Error("Resume content too short. Please provide more text.");
    }

    const heuristicDraft = structureResumeText(content);
    let raw: RawParsedResumeInput = {
        profile: heuristicDraft.profile,
        experience: heuristicDraft.experience,
        projects: heuristicDraft.projects,
        competencies: heuristicDraft.competencies,
        education: heuristicDraft.education,
        generatedSummary: heuristicDraft.generatedSummary,
        sectionOrder: heuristicDraft.sectionOrder,
        sectionHeadings: heuristicDraft.sectionHeadings,
        additionalSections: heuristicDraft.additionalSections,
        sourceHeader: heuristicDraft.sourceHeader,
    };

    let usedHeuristic = true;
    if (options.withModel) {
        const merged = mergeModelIntoHeuristic(raw, await readWithSealedAi(content, heuristicDraft.profile?.name));
        raw = merged.raw;
        usedHeuristic = merged.usedHeuristic;
    }
    const engine: LocalAiEngineId = usedHeuristic ? "heuristic" : "sealed";

    const confidence = scoreLocalParseConfidence(raw);

    const data = normalizeParsedResume(raw, {
        localRules: usedHeuristic,
        confidence,
    });

    return { data, engine, engineLabel: ENGINE_LABELS[engine] };
}
