/**
 * tailor_resume: the site's "Customize résumé" for a connected AI. It returns
 * the draft the site makes from the résumé on file for one posting, every
 * change with its reason (the rows `TailorChangeList` shows, each of which the
 * person can undo), and the tailored résumé as the text the dialog's Copy
 * gives (`resumeDataToZipMarkdown`). It saves nothing: the AI files the
 * version the person settles on with save_resume_variant.
 *
 * Which engine writes the draft is the route's choice (`ToolDeps.tailor`).
 * Every engine hands back the same `TailorDraft` (changes over a base résumé,
 * through the grounding gate), so this tool and its output don't change when
 * the engine does; `engine` names the one that wrote it.
 */
import { heuristicTailorResume, resumeFullText, withRoleOrder, type TailorChange, type TailorDraft } from "../local-ai/tailor-resume";
import { groundDraft, jobToTailorInput } from "../local-ai/tailor-ground";
import { descriptionToBullets } from "../resume/merge-bullet-lines";
import { resumeDataToZipMarkdown } from "../resume/to-zip-markdown";
import type { PublicJob } from "../jobs/types";
import type { ResumeData } from "@/types/resume";
import { lookupJobById, resumeNeededError, type ToolDeps } from "./tools";

/**
 * The draft every no-model path on the site gets (`tailorWithRules`,
 * tailor-with-engine.ts): the rules rewrite, grounded, then ordered. Composed
 * here rather than imported because that module also loads the browser's
 * on-device engines; tests/unit/mcp-site-parity.test.ts holds the two equal.
 */
export async function rulesTailor(resume: ResumeData, job: PublicJob): Promise<TailorDraft> {
    const input = jobToTailorInput(job);
    return withRoleOrder(groundDraft(resumeFullText(resume), heuristicTailorResume(resume, input)), input);
}

export interface TailorChangeOut {
    id: string;
    kind: TailorChange["kind"];
    /** Where on the résumé: "Summary", "<role> · <company>" or "Skills", as the site groups them. */
    section: string;
    /** summary/line: the text as it was; order: the role's lines in their old order; skills: the group as it was. */
    before: string;
    after: string;
    why: string;
}

export interface TailorResumeOut {
    job_id: string;
    engine: string;
    changes: TailorChangeOut[];
    /** The résumé with every change applied, as the site's Copy gives it. */
    resume_text: string;
    note?: string;
}

/** The site's wording when the draft has no change (`TailorChangeList`). */
export const NO_TAILOR_CHANGES_NOTE = "Your résumé already reads the way this posting does. Nothing to reword or move.";

function entryLines(resume: ResumeData, source: "experience" | "project", entryId: string): string[] {
    const list = source === "project" ? resume.projects : resume.experience;
    const entry = list?.find((e) => e.id === entryId);
    return entry ? descriptionToBullets(entry.description ?? "") : [];
}

function changeOut(draft: TailorDraft, change: TailorChange): TailorChangeOut {
    const { id, kind, why } = change;
    switch (change.kind) {
        case "summary":
            return { id, kind, section: "Summary", before: change.before, after: change.after, why };
        case "line":
            return { id, kind, section: [change.role, change.company].filter(Boolean).join(" · "), before: change.before, after: change.after, why };
        case "order":
            return {
                id, kind,
                section: [change.role, change.company].filter(Boolean).join(" · "),
                before: entryLines(draft.base, change.source, change.entryId).join("\n"),
                after: entryLines(draft.tailored, change.source, change.entryId).join("\n"),
                why,
            };
        case "skills":
            return { id, kind, section: change.category || "Skills", before: change.before.join(", "), after: change.after.join(", "), why };
    }
}

export async function toolTailorResume(deps: ToolDeps, input: { job_id: string }): Promise<TailorResumeOut | { error: string }> {
    const base = await deps.getBaseResume(deps.uid);
    if (base.source !== "resume_data") return { error: resumeNeededError(base, "tailor_resume", "rewrites") };
    const lookup = await lookupJobById(deps, input.job_id);
    if (lookup.kind === "unavailable") return { error: "search backend unavailable" };
    if (lookup.kind === "not_found") return { error: "job not found" };
    // The posting is read whole, so it counts like a get_job.
    const budget = await deps.consumeRecordBudget(1);
    if (!budget.ok) return { error: budget.error };
    const draft = await deps.tailor(base.resume_data, lookup.job);
    return {
        job_id: lookup.job.id,
        engine: draft.engineLabel,
        changes: draft.changes.map((change) => changeOut(draft, change)),
        resume_text: resumeDataToZipMarkdown(draft.tailored),
        ...(draft.changes.length === 0 ? { note: NO_TAILOR_CHANGES_NOTE } : {}),
    };
}
