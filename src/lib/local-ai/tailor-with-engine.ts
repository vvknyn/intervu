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
    finishDraft,
    heuristicTailorResume,
    resumeFullText,
    roleTermsForJob,
    withRoleOrder,
    type TailorChange,
    type TailorDraft,
    type TailorJobInput,
} from "./tailor-resume";
import { ENGINE_LABELS } from "./engines/types";
import { groundDraft } from "./tailor-ground";
import { descriptionToBullets } from "@/lib/resume/merge-bullet-lines";
import { roleTermHits, roleTermSet } from "@/lib/resume/order-for-role";
import type { ResumeData, ResumeExperience } from "@/types/resume";

/** A rewrite of one line: `line` is the id the prompt gave it ("exp-1#2");
 *  an older reply names only the entry (`experienceId`), meaning its first line. */
type ModelBullet = { line?: string; experienceId?: string; text?: string };

type ModelTailorOutput = {
    summary?: string;
    lines?: ModelBullet[];
    bullets?: ModelBullet[];
};

export const TAILOR_VOICE_RULES = `Voice rules (still truthful — no invented employers, titles, dates, or metrics):
- Sound like a strong human résumé: concrete, varied rhythm, not keyword-stuffed
- Avoid buzzword stacks, "Results-driven…", repeating the job title in every bullet, "Responsible for X. Responsible for Y."
- Prefer verbs from the original bullet; weave JD language only where it already fits the meaning
- Lead each line with what the posting asks for when the line already says it
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

const MODEL_ENTRIES_MAX = 4;
const MODEL_LINES_PER_ENTRY = 3;

/** The lines offered to the model: per entry, the ones using the posting's
 *  words most, each with an id ("exp-1#2") its reply names. */
function modelLines(entries: ResumeExperience[], terms: ReadonlySet<string>): string {
    return entries
        .filter((e) => e.description?.trim())
        .slice(0, MODEL_ENTRIES_MAX)
        .flatMap((e) => {
            const lines = descriptionToBullets(e.description);
            const picked = lines
                .map((line, index) => ({ line, index, hits: roleTermHits(line, terms) }))
                .sort((a, b) => b.hits - a.hits || a.index - b.index)
                .slice(0, MODEL_LINES_PER_ENTRY)
                .sort((a, b) => a.index - b.index);
            return picked.map((p) => `- [${e.id}#${p.index}] (${e.role}, ${e.company}) ${p.line.slice(0, 240)}`);
        })
        .join("\n");
}

export function buildModelPrompt(resume: ResumeData, job: TailorJobInput): string {
    const terms = roleTermSet(roleTermsForJob(job));
    const experienceLines = modelLines(resume.experience, terms);
    const projectLines = modelLines(resume.projects ?? [], terms);
    const projectSection = projectLines ? `\n\nPROJECT LINES:\n${projectLines}` : "";

    const desc = (job.description ?? "").slice(0, 800);

    const locationLine = job.location?.trim() ? `location: ${job.location.trim()}\n` : "";

    return `Tailor this résumé for the job. Keep truthfulness: do NOT invent employers, titles, dates, skills, tools or numeric metrics. Reword each line in the posting's language only where the line already says it, and keep every fact.

${TAILOR_VOICE_RULES}

JOB:
title: ${job.title}
company: ${job.company ?? ""}
${locationLine}tags: ${(job.tags ?? []).join(", ")}
occupation: ${job.occupation ?? ""}
description: ${desc}

CURRENT SUMMARY:
${resume.generatedSummary || resume.profile.profession}

EXPERIENCE LINES:
${experienceLines}${projectSection}

Return JSON only — "line" is the id in square brackets of the line you rewrote, from EXPERIENCE or PROJECT lines:
{"summary":"...","lines":[{"line":"...","text":"..."}]}`;
}

/** Where a model rewrite lands: the entry and the line's index, or null when the id names neither. */
function locateModelLine(
    b: ModelBullet,
    entries: { source: "experience" | "project"; entry: ResumeExperience }[],
): { source: "experience" | "project"; entry: ResumeExperience; index: number } | null {
    const id = b.line?.trim();
    if (id) {
        const hash = id.lastIndexOf("#");
        const entryId = hash > 0 ? id.slice(0, hash) : id;
        const index = hash > 0 ? Number(id.slice(hash + 1)) : 0;
        const found = entries.find((e) => e.entry.id === entryId);
        if (!found || !Number.isInteger(index)) return null;
        return descriptionToBullets(found.entry.description)[index] === undefined ? null : { ...found, index };
    }
    const entryId = b.experienceId?.trim();
    const found = entryId ? entries.find((e) => e.entry.id === entryId) : undefined;
    if (!found) return null;
    const index = descriptionToBullets(found.entry.description).findIndex((l) => l.length >= 8);
    return index < 0 ? null : { ...found, index };
}

/** A rewrite that names another of the person's employers ("…at Beta Inc")
 *  on this one's line moves a fact between jobs: never accepted. */
function namesAnotherEmployer(text: string, entry: ResumeExperience, all: ResumeExperience[]): boolean {
    const lower = text.toLowerCase();
    if (lower.includes(entry.company.toLowerCase()) || !/\b(at|for)\s+[A-Z]/.test(text)) return false;
    return all.some((e) => e.id !== entry.id && e.company.trim() && lower.includes(e.company.toLowerCase()));
}

/**
 * The model's rewrites as changes on top of the rules draft: a line the model
 * rewrote takes the model's wording, every other line keeps the rules', and
 * the model's summary replaces the rules' when the résumé has one. Null when
 * the model rewrote no line, so the caller falls back to the rules draft.
 */
export function applyModelTailor(
    resume: ResumeData,
    job: TailorJobInput,
    parsed: ModelTailorOutput,
    engineId: ReturnType<typeof getActiveEngineId>,
): TailorDraft | null {
    if (!parsed.summary?.trim()) return null;

    const rules = heuristicTailorResume(resume, job);
    const all = [...rules.base.experience, ...(rules.base.projects ?? [])];
    const located = [
        ...rules.base.experience.map((entry) => ({ source: "experience" as const, entry })),
        ...(rules.base.projects ?? []).map((entry) => ({ source: "project" as const, entry })),
    ];

    const modelChanges = new Map<string, TailorChange>();
    for (const b of [...(parsed.lines ?? []), ...(parsed.bullets ?? [])]) {
        const text = b.text?.trim();
        const at = text ? locateModelLine(b, located) : null;
        if (!text || !at || namesAnotherEmployer(text, at.entry, all)) continue;
        const before = descriptionToBullets(at.entry.description)[at.index];
        if (text === before) continue;
        const id = `line:${at.source}:${at.entry.id}:${at.index}`;
        modelChanges.set(id, {
            id,
            kind: "line",
            source: at.source,
            entryId: at.entry.id,
            index: at.index,
            company: at.entry.company,
            role: at.entry.role,
            before,
            after: text,
            why: "Reworded on this device for this posting.",
        });
    }
    if (modelChanges.size === 0) return null;

    const summaryBefore = rules.summaryBefore;
    const summary = parsed.summary.trim();
    const changes: TailorChange[] = [
        ...(summaryBefore && summary !== summaryBefore
            ? [{ id: "summary", kind: "summary" as const, before: summaryBefore, after: summary, why: "Reworded on this device for this posting." }]
            : rules.changes.filter((c) => c.kind === "summary")),
        ...rules.changes.filter((c) => c.kind === "line" && !modelChanges.has(c.id)),
        ...modelChanges.values(),
    ];

    return finishDraft({ ...rules, engineId, engineLabel: getActiveEngineLabel(), changes });
}

/** The rules draft, grounded and ordered: what every no-model path gets. */
export function tailorWithRules(resume: ResumeData, job: TailorJobInput): TailorDraft {
    return withRoleOrder(groundDraft(resumeFullText(resume), heuristicTailorResume(resume, job)), job);
}

export async function tailorResumeForJob(
    resume: ResumeData,
    job: TailorJobInput,
    opts?: { allowModel?: boolean },
): Promise<TailorDraft> {
    const allowModel = opts?.allowModel ?? false;
    const heuristicFallback = () => tailorWithRules(resume, job);

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

    return withRoleOrder(groundDraft(resumeFullText(resume), modelDraft), job);
}

export { ENGINE_LABELS };
export { groundDraft, jobToTailorInput } from "./tailor-ground";
