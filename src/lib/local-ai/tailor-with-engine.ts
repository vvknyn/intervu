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
import {
    heuristicTailorResume,
    resumeFullText,
    type TailorBulletDiff,
    type TailorDraft,
    type TailorJobInput,
} from "./tailor-resume";
import { ENGINE_LABELS } from "./engines/types";
import { groundDraft } from "./tailor-ground";
import type { ResumeData, ResumeExperience } from "@/types/resume";

type ModelBullet = { experienceId?: string; text?: string };

type ModelTailorOutput = {
    summary?: string;
    bullets?: ModelBullet[];
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

/** Snippet lines for one résumé section (experience or projects — same
 *  `ResumeExperience` shape) — shared so the model prompt offers both
 *  sections' ids as equally valid bullet targets. */
function buildEntrySnippets(entries: ResumeExperience[], max: number): string {
    return entries
        .filter((e) => e.description?.trim())
        .slice(0, max)
        .map((e) => {
            const firstBullet = e.description.split(/\n|•/).map((l) => l.trim()).find((l) => l.length >= 8) ?? "";
            return `- id: ${e.id}, role: ${e.role}, company: ${e.company}, bullet: ${firstBullet.slice(0, 200)}`;
        })
        .join("\n");
}

export function buildModelPrompt(resume: ResumeData, job: TailorJobInput): string {
    const experienceSnippets = buildEntrySnippets(resume.experience, 4);
    const projectSnippets = buildEntrySnippets(resume.projects ?? [], 4);
    const projectSection = projectSnippets ? `\n\nPROJECT SNIPPETS:\n${projectSnippets}` : "";

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
${experienceSnippets}${projectSection}

Return JSON only — "experienceId" may be an id from either EXPERIENCE or PROJECT snippets:
{"summary":"...","bullets":[{"experienceId":"...","text":"..."}]}`;
}

/** Matches model-produced bullets against one résumé section — experience or
 *  projects, which share the `ResumeExperience` shape — patching
 *  `tailoredList` in place and returning one `TailorBulletDiff` per accepted
 *  match. Shared by both the experience and project passes in
 *  `applyModelTailor` so a project bullet from the engine is matched,
 *  cross-checked and diffed exactly like an experience bullet; `source` is
 *  set by the caller and never read from model output. */
function applyModelBulletsForEntries(
    entries: ResumeExperience[],
    tailoredList: ResumeExperience[],
    source: TailorBulletDiff["source"],
    modelBullets: ModelBullet[],
    allEntries: ResumeExperience[],
): TailorBulletDiff[] {
    const bullets: TailorBulletDiff[] = [];

    for (const b of modelBullets) {
        const entryId = b.experienceId?.trim();
        const text = b.text?.trim();
        if (!entryId || !text) continue;

        const idx = entries.findIndex((e) => e.id === entryId);
        if (idx < 0) continue;

        const entry = entries[idx];
        const hit = entry.description.split(/\n|•/).map((l) => l.trim()).find((l) => l.length >= 8);
        if (!hit) continue;

        if (text.toLowerCase().includes(entry.company.toLowerCase()) === false && /\b(at|for)\s+[A-Z]/.test(text)) {
            const origCompany = entry.company.toLowerCase();
            const mentioned = allEntries.some(
                (e) => e.id !== entryId && text.toLowerCase().includes(e.company.toLowerCase()),
            );
            if (mentioned && !text.toLowerCase().includes(origCompany)) continue;
        }

        const lines = entry.description.split(/\n|•/).map((l) => l.replace(/^[\s\-*]+/, "").trim()).filter(Boolean);
        const lineIdx = lines.findIndex((l) => l === hit || l.includes(hit.slice(0, 20)));
        if (lineIdx >= 0) {
            lines[lineIdx] = text;
            tailoredList[idx] = {
                ...tailoredList[idx],
                description: lines.join("\n"),
            };
        }

        bullets.push({
            experienceId: entry.id,
            source,
            company: entry.company,
            role: entry.role,
            before: hit,
            after: text,
        });
    }

    return bullets;
}

export function applyModelTailor(
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

    const modelBullets = parsed.bullets ?? [];
    const allEntries = [...resume.experience, ...(resume.projects ?? [])];
    const bullets: TailorBulletDiff[] = [
        ...applyModelBulletsForEntries(resume.experience, tailored.experience, "experience", modelBullets, allEntries),
        ...applyModelBulletsForEntries(resume.projects ?? [], tailored.projects ?? [], "project", modelBullets, allEntries),
    ];

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
    const resumeText = resumeFullText(resume);
    const heuristicFallback = () => groundDraft(resumeText, heuristicTailorResume(resume, job));

    if (!allowModel || !readLocalAiConsent()) {
        return heuristicFallback();
    }

    await initLocalAiLadder();
    const engineId = getActiveEngineId();

    if (engineId === "heuristic") {
        return heuristicFallback();
    }

    const raw = await generateWithActiveEngine(buildModelPrompt(resume, job));
    if (!raw) {
        return heuristicFallback();
    }

    const parsed = tryParseModelJson(raw);
    if (!parsed) {
        return heuristicFallback();
    }

    const modelDraft = applyModelTailor(resume, job, parsed, engineId);
    if (!modelDraft) {
        return heuristicFallback();
    }

    return groundDraft(resumeText, modelDraft);
}

export { ENGINE_LABELS };
export { groundDraft, jobToTailorInput } from "./tailor-ground";
