/**
 * Best-effort on-device tailor with labeled rules fallback.
 * Never calls paid cloud APIs.
 */

import { readLocalAiConsent } from "./consent";
import {
    generateWithActiveEngine,
    getActiveEngineId,
    getActiveEngineLabel,
    initLocalAiLadder,
} from "./ladder";
import { locationText } from "@/lib/jobs/presentation";
import {
    heuristicTailorResume,
    introducesNewNumbers,
    type TailorDraft,
    type TailorJobInput,
} from "./tailor-resume";
import { ENGINE_LABELS } from "./engines/types";
import type { ResumeData } from "@/types/resume";

type ModelTailorOutput = {
    summary?: string;
    bullets?: Array<{ experienceId?: string; text?: string }>;
};

export const TAILOR_VOICE_RULES = `Voice rules (still truthful — no invented employers, titles, dates, or metrics):
- Sound like a strong human résumé: concrete, varied rhythm, not keyword-stuffed
- Avoid buzzword stacks, "Results-driven…", repeating the job title in every bullet, "Responsible for X. Responsible for Y."
- Prefer verbs from the original bullet; weave JD language only where it already fits the meaning
- Summary: 2–4 natural sentences (or one tight paragraph), not a skill list
- Bullets: keep original structure and length band; do not homogenize every line`;

function tryParseModelJson(text: string): ModelTailorOutput | null {
    const trimmed = text.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
        return JSON.parse(trimmed.slice(start, end + 1)) as ModelTailorOutput;
    } catch {
        return null;
    }
}

export function buildModelPrompt(resume: ResumeData, job: TailorJobInput): string {
    const snippets = resume.experience
        .filter((e) => e.description?.trim())
        .slice(0, 4)
        .map((e) => {
            const firstBullet = e.description.split(/\n|•/).map((l) => l.trim()).find((l) => l.length >= 8) ?? "";
            return `- id: ${e.id}, role: ${e.role}, company: ${e.company}, bullet: ${firstBullet.slice(0, 200)}`;
        })
        .join("\n");

    const desc = (job.description ?? "").slice(0, 800);

    const locationLine = job.location?.trim() ? `location: ${job.location.trim()}\n` : "";

    return `Tailor this résumé for the job. Keep truthfulness: do NOT invent employers, titles, dates, or numeric metrics. Mirror JD language where already implied by the original text.

${TAILOR_VOICE_RULES}

JOB:
title: ${job.title}
company: ${job.company ?? ""}
${locationLine}tags: ${(job.tags ?? []).join(", ")}
occupation: ${job.occupation ?? ""}
description: ${desc}

CURRENT SUMMARY:
${resume.generatedSummary || resume.profile.profession}

EXPERIENCE SNIPPETS:
${snippets}

Return JSON only:
{"summary":"...","bullets":[{"experienceId":"...","text":"..."}]}`;
}

function applyModelTailor(
    resume: ResumeData,
    job: TailorJobInput,
    parsed: ModelTailorOutput,
    engineId: ReturnType<typeof getActiveEngineId>,
): TailorDraft | null {
    if (!parsed.summary?.trim()) return null;

    const tailored = JSON.parse(JSON.stringify(resume)) as ResumeData;
    const summaryBefore =
        resume.generatedSummary?.trim() ||
        `${resume.profile.profession} — ${resume.profile.yearsOfExperience}+ years`;

    tailored.generatedSummary = parsed.summary.trim();

    const bullets: TailorDraft["bullets"] = [];
    const modelBullets = parsed.bullets ?? [];

    for (const b of modelBullets) {
        const expId = b.experienceId?.trim();
        const text = b.text?.trim();
        if (!expId || !text) continue;

        const expIdx = resume.experience.findIndex((e) => e.id === expId);
        if (expIdx < 0) continue;

        const exp = resume.experience[expIdx];
        const hit = exp.description.split(/\n|•/).map((l) => l.trim()).find((l) => l.length >= 8);
        if (!hit) continue;

        if (introducesNewNumbers(hit, text)) continue;
        if (text.toLowerCase().includes(exp.company.toLowerCase()) === false && /\b(at|for)\s+[A-Z]/.test(text)) {
            const origCompany = exp.company.toLowerCase();
            const mentioned = resume.experience.some(
                (e) => e.id !== expId && text.toLowerCase().includes(e.company.toLowerCase()),
            );
            if (mentioned && !text.toLowerCase().includes(origCompany)) continue;
        }

        const lines = exp.description.split(/\n|•/).map((l) => l.replace(/^[\s\-*]+/, "").trim()).filter(Boolean);
        const lineIdx = lines.findIndex((l) => l === hit || l.includes(hit.slice(0, 20)));
        if (lineIdx >= 0) {
            lines[lineIdx] = text;
            tailored.experience[expIdx] = {
                ...tailored.experience[expIdx],
                description: lines.join("\n"),
            };
        }

        bullets.push({
            experienceId: exp.id,
            company: exp.company,
            role: exp.role,
            before: hit,
            after: text,
        });
    }

    if (bullets.length === 0) return null;

    return {
        engineId,
        engineLabel: getActiveEngineLabel(),
        usedDescription: Boolean(job.description?.trim()),
        summaryBefore,
        summaryAfter: parsed.summary.trim(),
        bullets: bullets.slice(0, 4),
        tailored,
    };
}

export async function tailorResumeForJob(
    resume: ResumeData,
    job: TailorJobInput,
    opts?: { allowModel?: boolean },
): Promise<TailorDraft> {
    const allowModel = opts?.allowModel ?? false;

    if (!allowModel || !readLocalAiConsent()) {
        return heuristicTailorResume(resume, job);
    }

    await initLocalAiLadder();
    const engineId = getActiveEngineId();

    if (engineId === "heuristic") {
        return heuristicTailorResume(resume, job);
    }

    const raw = await generateWithActiveEngine(buildModelPrompt(resume, job));
    if (!raw) {
        return heuristicTailorResume(resume, job);
    }

    const parsed = tryParseModelJson(raw);
    if (!parsed) {
        return heuristicTailorResume(resume, job);
    }

    const modelDraft = applyModelTailor(resume, job, parsed, engineId);
    if (!modelDraft) {
        return heuristicTailorResume(resume, job);
    }

    return modelDraft;
}

/** PublicJob → TailorJobInput adapter for UI callers. */
export function jobToTailorInput(job: {
    title: string;
    company?: string | null;
    tags?: string[] | null;
    description?: string | null;
    occupation?: string | null;
    location?: string | null;
    location_city?: string | null;
    location_state?: string | null;
    location_country?: string | string[] | null;
    work_type?: string | null;
}): TailorJobInput {
    const place = locationText(job as Parameters<typeof locationText>[0]);
    const location =
        place && place !== "Location not listed" ? place : (job.location?.trim() || null);
    return {
        title: job.title,
        company: job.company,
        tags: job.tags,
        description: job.description,
        occupation: job.occupation,
        location,
    };
}

export { ENGINE_LABELS };
