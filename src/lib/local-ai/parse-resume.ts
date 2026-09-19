/**
 * Client-side résumé parse — no cloud LLM, no OpenRouter.
 *
 * Ladder: Nano → WebLLM → Transformers WASM → deterministic rules.
 * Rules path always runs so the /jobs journey never hard-depends on a download.
 */

import { normalizeParsedResume, type RawParsedResumeInput } from "@/lib/resume/normalize-parsed-resume";
import { structureResumeText } from "@/lib/resume/structure-resume-text";
import type { ParsedResumeResult } from "@/types/resume";
import { scoreLocalParseConfidence } from "./parse-confidence";
import { getActiveEngineId, getEngineLabel, initLocalAiLadder, parseWithActiveEngine } from "./ladder";
import type { LocalAiEngineId } from "./engines/types";

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
        competencies: heuristic.competencies,
        education: heuristic.education,
        generatedSummary: heuristic.generatedSummary,
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

export interface ParseResumeLocallyOptions {
    /**
     * User declined the model download (the modal's "Skip the download"
     * link). Stay on the heuristic rung deterministically — never init the
     * ladder or run a model, even if one happens to already be active from
     * an unrelated feature (e.g. job-tailoring).
     */
    skipDownload?: boolean;
}

/**
 * Parse résumé text entirely on-device — no cloud LLM, ever. Model paths
 * (Nano/WebLLM/WASM) require ladder init (after consent); rules always work.
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
        competencies: heuristicDraft.competencies,
        education: heuristicDraft.education,
        generatedSummary: heuristicDraft.generatedSummary,
    };

    let effectiveEngine: LocalAiEngineId = "heuristic";
    let usedHeuristic = true;

    if (!options.skipDownload) {
        await initLocalAiLadder();
        const modelOut = await parseWithActiveEngine(content);
        const merged = mergeModelIntoHeuristic(raw, modelOut);
        raw = merged.raw;
        usedHeuristic = merged.usedHeuristic;

        const engine = getActiveEngineId();
        effectiveEngine = usedHeuristic || engine === "heuristic" ? "heuristic" : engine;
    }

    const confidence = scoreLocalParseConfidence(raw);

    const data = normalizeParsedResume(raw, {
        localRules: usedHeuristic,
        confidence,
    });

    return {
        data,
        engine: effectiveEngine,
        engineLabel: getEngineLabel(effectiveEngine),
    };
}
