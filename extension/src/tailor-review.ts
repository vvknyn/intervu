/**
 * Approving a tailored résumé one change at a time. Velai's rules propose the
 * changes (`rulesTailorDraft`, the same draft velai.app's "Customize résumé"
 * and the MCP tailor_resume tool make: lines in the job's words, the summary,
 * the lines and skills it asks for first, a project to leave off), each with
 * the reason for it. Nothing is applied until the person accepts it, and the
 * résumé that is downloaded, copied or attached to a form is the person's own
 * with only the accepted changes (`applyTailorChanges`).
 *
 * What is remembered between visits is only which changes were accepted and
 * which rejected, as `id#fingerprint` strings with no résumé text in them, and
 * only while the résumé is the one they were decided on and the change still
 * says what it said when they decided (`fingerprint`): a change that reads
 * differently now, because the posting or the résumé did, is asked again.
 * Pure; the storage is tailor-choices.ts.
 */
import { applyTailorChanges, type TailorChange, type TailorDraft } from "@/lib/local-ai/tailor-resume";
import { jobToTailorInput } from "@/lib/local-ai/tailor-ground";
import { rulesTailorDraft } from "@/lib/local-ai/tailor-rules";
import { descriptionToBullets } from "@/lib/resume/merge-bullet-lines";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

/** The site's words when the draft has no change (`TailorChangeList`). */
export const NO_CHANGES_TEXT = "Your résumé already reads the way this posting does. Nothing to reword or move.";

export function proposeChanges(resume: ResumeData, job: PublicJob): TailorDraft {
    return rulesTailorDraft(resume, jobToTailorInput(job));
}

export type Decision = "accepted" | "rejected";

export interface ReviewItem {
    id: string;
    /** `id#hash` of what the change says, the form it is remembered in. */
    mark: string;
    kind: TailorChange["kind"];
    /** The person's own text for this part of the résumé. */
    before: string;
    /** What would replace it; for a project to leave off, the offer in words. */
    after: string;
    /** The label above `after`: "Proposed", or what a move or an offer is. */
    afterLabel: string;
    why: string;
}

export interface ReviewSection {
    title: string;
    items: ReviewItem[];
}

/** A short stable hash of what a change says, so a remembered decision is never applied to a different change. */
export function fingerprint(change: TailorChange): string {
    const text = JSON.stringify([
        change.kind,
        change.id,
        "before" in change ? change.before : "",
        "after" in change ? change.after : "order" in change ? change.order : "",
    ]);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

function entryLines(resume: ResumeData, source: "experience" | "project", entryId: string): string[] {
    const list = source === "project" ? resume.projects : resume.experience;
    return descriptionToBullets(list?.find((e) => e.id === entryId)?.description ?? "");
}

/** How many of a role's lines the panel shows when it shows their order. */
const ORDER_SHOWN = 2;

function lines(list: string[]): string {
    return list.slice(0, ORDER_SHOWN).join("\n");
}

function itemOf(draft: TailorDraft, change: TailorChange): ReviewItem {
    const base = { id: change.id, mark: `${change.id}#${fingerprint(change)}`, kind: change.kind, why: change.why };
    switch (change.kind) {
        case "summary":
        case "line":
            return { ...base, before: change.before, after: change.after, afterLabel: "Proposed" };
        case "order": {
            const before = entryLines(draft.base, change.source, change.entryId);
            const after = change.order.length === before.length ? change.order.map((i) => before[i]) : before;
            return { ...base, before: lines(before), after: lines(after), afterLabel: "Proposed first lines" };
        }
        case "skills":
            return { ...base, before: change.before.join(", "), after: change.after.join(", "), afterLabel: "Proposed" };
        case "leave-out": {
            const own = entryLines(draft.base, change.source, change.entryId);
            return {
                ...base,
                before: lines(own) || [change.role, change.company].filter(Boolean).join(" · "),
                after: "Leave this project off this version of your résumé.",
                afterLabel: "Proposed",
            };
        }
    }
}

/** Within a role: leaving it off first, then its lines, then their order. */
const rank = (c: TailorChange) => (c.kind === "leave-out" ? 0 : c.kind === "order" ? 2 : 1);

/** The proposed changes grouped as the site's list groups them: the summary, each role, the skills. */
export function reviewSections(draft: TailorDraft): ReviewSection[] {
    const sections: ReviewSection[] = [];
    const summary = draft.changes.filter((c) => c.kind === "summary");
    if (summary.length) sections.push({ title: "Summary", items: summary.map((c) => itemOf(draft, c)) });
    const entries = [
        ...draft.base.experience.map((entry) => ({ source: "experience" as const, entry })),
        ...(draft.base.projects ?? []).map((entry) => ({ source: "project" as const, entry })),
    ];
    for (const { source, entry } of entries) {
        const mine = draft.changes
            .filter((c) => (c.kind === "line" || c.kind === "order" || c.kind === "leave-out") && c.source === source && c.entryId === entry.id)
            .sort((a, b) => rank(a) - rank(b) || (a.kind === "line" && b.kind === "line" ? a.index - b.index : 0));
        if (mine.length) sections.push({ title: [entry.role, entry.company].filter(Boolean).join(" · "), items: mine.map((c) => itemOf(draft, c)) });
    }
    const skills = draft.changes.filter((c) => c.kind === "skills");
    if (skills.length) sections.push({ title: "Skills", items: skills.map((c) => itemOf(draft, c)) });
    return sections;
}

/** What was decided on a job, as remembered: marks only, never text from the résumé. */
export interface StoredChoice {
    at: number;
    /** When the résumé was last saved on Velai; a choice made on another version is dropped. */
    resumeAt: string | null;
    accepted: string[];
    rejected: string[];
}

/** Pure: which of the draft's changes the remembered choice decides, as the person decided them. */
export function decisionsFor(draft: TailorDraft, stored: StoredChoice | null, resumeAt: string | null): Map<string, Decision> {
    const out = new Map<string, Decision>();
    if (!stored || stored.resumeAt !== resumeAt) return out;
    const accepted = new Set(stored.accepted);
    const rejected = new Set(stored.rejected);
    for (const change of draft.changes) {
        const mark = `${change.id}#${fingerprint(change)}`;
        if (accepted.has(mark)) out.set(change.id, "accepted");
        else if (rejected.has(mark)) out.set(change.id, "rejected");
    }
    return out;
}

/** Pure: the choice to remember for these decisions. */
export function choiceOf(draft: TailorDraft, decisions: ReadonlyMap<string, Decision>, resumeAt: string | null, at: number): StoredChoice {
    const marks = (want: Decision) =>
        draft.changes.filter((c) => decisions.get(c.id) === want).map((c) => `${c.id}#${fingerprint(c)}`);
    return { at, resumeAt, accepted: marks("accepted"), rejected: marks("rejected") };
}

/** Pure: the person's résumé with only the accepted changes (a copy; `draft.base` is left as it was). */
export function acceptedResume(draft: TailorDraft, decisions: ReadonlyMap<string, Decision>): ResumeData {
    return applyTailorChanges(draft.base, draft.changes.filter((c) => decisions.get(c.id) === "accepted"));
}

export function acceptedCount(draft: TailorDraft, decisions: ReadonlyMap<string, Decision>): number {
    return draft.changes.filter((c) => decisions.get(c.id) === "accepted").length;
}

function norm(text: string | null | undefined): string {
    return (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Which job a choice belongs to: its employer and title, so the card and the panel agree. Null when the title is unknown. */
export function choiceKey(job: Pick<PublicJob, "title" | "company">): string | null {
    const title = norm(job.title);
    return title ? `${norm(job.company)}|${title}` : null;
}

/** Choices kept: the most recent, and none older than this. */
export const CHOICES_KEPT = 40;
export const CHOICES_KEPT_MS = 60 * 24 * 60 * 60_000;

/** Pure: the remembered choices without the old ones and beyond the most recent `CHOICES_KEPT`. */
export function pruneChoices(all: Record<string, StoredChoice>, now: number): Record<string, StoredChoice> {
    const fresh = Object.entries(all).filter(([, c]) => c && Number.isFinite(c.at) && now - c.at < CHOICES_KEPT_MS);
    fresh.sort((a, b) => b[1].at - a[1].at);
    return Object.fromEntries(fresh.slice(0, CHOICES_KEPT));
}
