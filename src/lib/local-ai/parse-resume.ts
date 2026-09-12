/**
 * Client-side résumé parse — no cloud LLM, no OpenRouter.
 *
 * Ladder: Nano → WebLLM → Transformers WASM → deterministic rules.
 * Rules path always runs so the /jobs journey never hard-depends on a download.
 */

import { normalizeParsedResume, type RawParsedResumeInput } from "@/lib/resume/normalize-parsed-resume";
import { structureResumeText } from "@/lib/resume/structure-resume-text";
import type { ParsedResumeResult } from "@/types/resume";
import { getActiveEngineId, getEngineLabel, initLocalAiLadder, parseWithActiveEngine } from "./ladder";
import type { LocalAiEngineId } from "./engines/types";

export interface LocalParseResult {
    data: ParsedResumeResult;
    engine: LocalAiEngineId;
    engineLabel: string;
}

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

function heuristicConfidence(hasExperience: boolean, hasSkills: boolean, hasEmail: boolean): number {
    let score = 55;
    if (hasEmail) score += 10;
    if (hasExperience) score += 15;
    if (hasSkills) score += 10;
    return Math.min(score, 75);
}

/**
 * Parse résumé text entirely on-device. Call only when local-ai flag is ON.
 * Requires ladder init (after consent) for model paths; rules always work.
 */
export async function parseResumeLocally(content: string): Promise<LocalParseResult> {
    if (!content || content.trim().length < 50) {
        throw new Error("Resume content too short. Please provide more text.");
    }

    await initLocalAiLadder();

    const heuristicDraft = structureResumeText(content);
    let raw: RawParsedResumeInput = {
        profile: heuristicDraft.profile,
        experience: heuristicDraft.experience,
        competencies: heuristicDraft.competencies,
        education: heuristicDraft.education,
        generatedSummary: heuristicDraft.generatedSummary,
    };

    let usedHeuristic = true;
    const modelOut = await parseWithActiveEngine(content);
    if (modelOut && typeof modelOut === "object") {
        const fromModel = modelOutputToRaw(modelOut);
        // Merge: prefer model where it filled a field, keep heuristic gaps filled.
        raw = {
            profile: { ...raw.profile, ...fromModel.profile },
            experience:
                Array.isArray(fromModel.experience) && fromModel.experience.length > 0
                    ? fromModel.experience
                    : raw.experience,
            competencies:
                Array.isArray(fromModel.competencies) && fromModel.competencies.length > 0
                    ? fromModel.competencies
                    : raw.competencies,
            education:
                Array.isArray(fromModel.education) && fromModel.education.length > 0
                    ? fromModel.education
                    : raw.education,
            generatedSummary: fromModel.generatedSummary || raw.generatedSummary,
        };
        usedHeuristic = false;
    }

    const engine = getActiveEngineId();
    const effectiveEngine: LocalAiEngineId =
        usedHeuristic || engine === "heuristic" ? "heuristic" : engine;

    const confBase = usedHeuristic
        ? heuristicConfidence(
              (raw.experience?.length ?? 0) > 0,
              (raw.competencies?.length ?? 0) > 0,
              Boolean(raw.profile?.email),
          )
        : 78;

    const data = normalizeParsedResume(raw, {
        localRules: usedHeuristic,
        confidence: {
            overall: confBase,
            profile: confBase,
            experience: (raw.experience?.length ?? 0) > 0 ? confBase + 5 : confBase - 10,
            competencies: (raw.competencies?.length ?? 0) > 0 ? confBase : confBase - 15,
            education: (raw.education?.length ?? 0) > 0 ? confBase : confBase - 10,
            summary: raw.generatedSummary ? confBase + 5 : confBase - 10,
        },
    });

    return {
        data,
        engine: effectiveEngine,
        engineLabel: getEngineLabel(effectiveEngine),
    };
}
