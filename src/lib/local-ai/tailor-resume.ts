/**
 * Pure heuristic résumé tailor — no window, no model download.
 * Rules fallback when on-device generation is unavailable or rejected, and
 * the whole tailor wherever no model runs (the For you download, the Velai
 * Chrome extension).
 *
 * A tailored résumé says what the person's own résumé says, in the posting's
 * words and in the order the posting cares about. Every edit is one
 * `TailorChange` with the reason for it, so the person can see each one and
 * undo any of them (`applyTailorChanges`):
 *  - "line": an experience or project line reworded in the posting's words
 *    (tailor-wording.ts: near-synonym verbs, "clients"/"customers", the
 *    posting's spelling, acronyms the posting spells out);
 *  - "summary": the summary in the posting's words, closing with the skills
 *    on the résumé that the posting asks for;
 *  - "order": a role's lines, the ones using the posting's words first;
 *  - "skills": a skills group, the skills the posting names first;
 *  - "leave-out": a project the posting asks nothing about, offered to leave
 *    off this version (tailor-asks.ts; off until the person turns it on).
 * Nothing is added that the résumé doesn't already say: no employer, title,
 * date, number or skill, and no summary when the résumé has none. The one
 * exception is a rewrite by the on-device model that takes a few of the
 * posting's own words the résumé doesn't use (`confirm`): it starts off, says
 * which words, and is used only if the person turns it on. The grounding gate
 * (tailor-ground.ts) checks every draft again before use.
 */

import type { LocalAiEngineId } from "./engines/types";
import { ENGINE_LABELS } from "./engines/types";
import { resumeMatchText } from "@/lib/resume/match-text";
import { BULLET_MARKER_RE, descriptionToBullets } from "@/lib/resume/merge-bullet-lines";
import { lineOrders, skillOrders } from "@/lib/resume/order-for-role";
import {
    equivalentWords,
    openingVerbBase,
    readPostingWording,
    respell,
    rewordLine,
    spellingKey,
    type PostingWording,
} from "./tailor-wording";
import type { ResumeData, ResumeExperience } from "@/types/resume";

export type TailorJobInput = {
    title: string;
    company?: string | null;
    tags?: string[] | null;
    description?: string | null;
    occupation?: string | null;
    location?: string | null;
};

export type TailorBulletDiff = {
    experienceId: string;
    /** Which array on `ResumeData` this bullet's `experienceId` indexes into
     *  — `experience` and `projects` share the same id-bearing shape. */
    source: "experience" | "project";
    company: string;
    role: string;
    before: string;
    after: string;
};

type EntrySource = TailorBulletDiff["source"];

/** One edit the tailor made, with the reason it gives the person (`why`). */
export type TailorChange =
    | { id: string; kind: "summary"; before: string; after: string; why: string; confirm?: string[] }
    | {
          id: string;
          kind: "line";
          source: EntrySource;
          entryId: string;
          /** The line's place among the entry's lines (`descriptionToBullets`) in the résumé tailored from. */
          index: number;
          company: string;
          role: string;
          before: string;
          after: string;
          why: string;
          /** The posting's words this rewrite uses that the résumé doesn't: true only if
           *  the person says so, so the change starts off (`startsOn`). */
          confirm?: string[];
      }
    | { id: string; kind: "leave-out"; source: EntrySource; entryId: string; company: string; role: string; why: string }
    | {
          id: string;
          kind: "order";
          source: EntrySource;
          entryId: string;
          company: string;
          role: string;
          /** `order[i]` is the index of the line that now comes i-th. */
          order: number[];
          why: string;
      }
    | { id: string; kind: "skills"; group: number; category: string; before: string[]; after: string[]; why: string };

export type TailorDraft = {
    engineId: LocalAiEngineId;
    engineLabel: string;
    usedDescription: boolean;
    summaryBefore: string;
    summaryAfter: string;
    /** The reworded lines, for callers that list them. */
    bullets: TailorBulletDiff[];
    /** The résumé the changes apply to. */
    base: ResumeData;
    changes: TailorChange[];
    /** The posting's words that mean the same as a word the résumé uses (`equivalentWords`);
     *  the grounding gate accepts these as it accepts the résumé's own. */
    equivalents: string[];
    /** `base` with every change that starts on applied (`startsOn`). */
    tailored: ResumeData;
};

/** A change is on until the person undoes it, except two that wait for them to
 *  turn them on: a rewrite that adds posting words they must confirm, and
 *  leaving a project out (word matching can't tell how much it matters). */
export function startsOn(change: TailorChange): boolean {
    if (change.kind === "leave-out") return false;
    return !((change.kind === "line" || change.kind === "summary") && change.confirm?.length);
}

const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
    "from", "as", "is", "was", "are", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall",
    "can", "need", "our", "your", "their", "this", "that", "these", "those", "it", "its",
    "we", "you", "they", "he", "she", "who", "what", "which", "when", "where", "how", "all",
    "each", "every", "both", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just", "also", "into", "over",
    "about", "after", "before", "between", "through", "during", "without", "within", "along",
    "across", "while", "per", "via", "etc", "role", "job", "work", "team", "company",
]);

const DESC_SLICE_CHARS = 1000;
/** The whole posting is read for its wording; this only bounds a pathological one. */
const POSTING_TEXT_MAX_CHARS = 12000;

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function uniqueTokens(text: string): string[] {
    return [...new Set(tokenize(text))];
}

/**
 * Every field of the résumé that counts as "the résumé's own text" — what
 * the grounding gate (`groundDraft`) checks a rewrite's words against.
 *
 * Builds on `resumeMatchText` (match-text.ts) — the one place that owns
 * "what free text counts as the résumé's own" (summary, experience
 * descriptions, project descriptions, skills) — layering on the structural
 * fields match-text.ts intentionally omits (profession, competency category
 * labels, experience/project role & company) so a rewrite is free to reuse a
 * job title or employer name without tripping the grounding gate.
 */
export function resumeFullText(resume: ResumeData): string {
    return [
        resume.profile.profession,
        resumeMatchText(resume),
        ...resume.competencies.map((c) => c.category),
        ...resume.experience.flatMap((e) => [e.role, e.company]),
        ...(resume.projects ?? []).flatMap((p) => [p.role, p.company]),
    ].join(" ");
}

function extractJdKeywords(job: TailorJobInput): string[] {
    const descSlice = (job.description ?? "").slice(0, DESC_SLICE_CHARS);
    const raw = [job.title, ...(job.tags ?? []), job.occupation ?? "", descSlice].join(" ");
    return uniqueTokens(raw);
}

/** The role's words (title, tags, occupation, the start of the posting): what a one-page tailored PDF keeps bullets for. */
export function roleTermsForJob(job: TailorJobInput): string[] {
    return extractJdKeywords(job);
}

/** Everything the posting says, for its wording. */
export function postingTextFor(job: TailorJobInput): string {
    return [job.title, ...(job.tags ?? []), job.occupation ?? "", (job.description ?? "").slice(0, POSTING_TEXT_MAX_CHARS)]
        .filter(Boolean)
        .join("\n");
}

function cloneResume(resume: ResumeData): ResumeData {
    return JSON.parse(JSON.stringify(resume)) as ResumeData;
}

/** Detect legacy robotic heuristic patterns — useful in tests. */
export function looksRoboticTailor(text: string): boolean {
    return (
        /Targeting .+ roles/i.test(text) ||
        /Skilled in /i.test(text) ||
        /^Led .+ — /m.test(text) ||
        /aligned with .+ responsibilities/i.test(text) ||
        /Results-driven/i.test(text)
    );
}

function quoteList(terms: string[]): string {
    return terms.map((t) => `“${t}”`).join(", ");
}

function listJoin(items: string[]): string {
    return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Word keys of `text`, plural-blind, for finding one phrase inside another. */
function phraseKeys(text: string): string[] {
    return (text.match(/\p{L}[\p{L}\p{N}]*(?:[-.+#][\p{L}\p{N}]+)*[+#]*/gu) ?? []).map((w) => {
        const key = spellingKey(w);
        return key.length > 3 ? key.replace(/s$/, "") : key;
    });
}

function indexOfPhrase(haystack: string[], needle: string[]): number {
    if (needle.length === 0) return -1;
    outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
        for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
        return i;
    }
    return -1;
}

const SUMMARY_SKILLS_MAX = 3;

/** How the summary names the posting's skills from the résumé ("Core skills
 *  include IV therapy, wound care and patient education."). Its own words
 *  claim nothing, so the grounding gate accepts them (`SUMMARY_SKILLS_WORDS`). */
const SUMMARY_SKILLS_LEAD = "Core skills include";
export const SUMMARY_SKILLS_WORDS: readonly string[] = SUMMARY_SKILLS_LEAD.toLowerCase().split(" ");

/** Skills listed on the résumé that the posting asks for by name and the
 *  summary doesn't mention yet, in the posting's order. */
function skillsThePostingNames(resume: ResumeData, postingText: string, summary: string): string[] {
    const posting = phraseKeys(postingText);
    const inSummary = phraseKeys(summary);
    const seen = new Set<string>();
    const named: { skill: string; at: number }[] = [];
    for (const skill of resume.competencies.flatMap((c) => c.skills)) {
        const keys = phraseKeys(skill);
        const id = keys.join(" ");
        if (!id || seen.has(id) || keys.length > 4) continue;
        seen.add(id);
        if (indexOfPhrase(inSummary, keys) >= 0) continue;
        const at = indexOfPhrase(posting, keys);
        if (at >= 0) named.push({ skill: skill.trim(), at });
    }
    return named.sort((a, b) => a.at - b.at).slice(0, SUMMARY_SKILLS_MAX).map((n) => n.skill);
}

/** The summary in the posting's words, closing with the posting's skills the résumé lists. */
function summaryChange(resume: ResumeData, job: TailorJobInput, wording: PostingWording, acronymsDone: Set<string>): TailorChange | null {
    const before = resume.generatedSummary?.trim() ?? "";
    // A résumé without a summary gets none: the tailor doesn't add a section the person didn't write.
    if (!before) return null;
    const reworded = rewordLine(before, wording, { roleOpeners: new Set(), acronymsDone, verbs: false });
    let after = reworded.after;
    const why: string[] = [];
    if (reworded.terms.length > 0) why.push(`Uses the posting's words: ${quoteList(reworded.terms)}.`);
    const named = skillsThePostingNames(resume, postingTextFor(job), after);
    if (named.length > 0) {
        after = `${after.replace(/[\s.]+$/, "")}. ${SUMMARY_SKILLS_LEAD} ${listJoin(named)}.`;
        why.push(`Names skills from your résumé that the posting asks for.`);
    }
    return after === before ? null : { id: "summary", kind: "summary", before, after, why: why.join(" ") };
}

function lineChangesFor(
    entries: ResumeExperience[],
    source: EntrySource,
    wording: PostingWording,
    acronymsDone: Set<string>,
): TailorChange[] {
    const out: TailorChange[] = [];
    for (const entry of entries) {
        const lines = descriptionToBullets(entry.description ?? "");
        const roleOpeners = new Set(lines.map(openingVerbBase).filter((v): v is string => !!v));
        lines.forEach((line, index) => {
            const { after, terms } = rewordLine(line, wording, { roleOpeners, acronymsDone, verbs: true });
            if (after === line) return;
            out.push({
                id: `line:${source}:${entry.id}:${index}`,
                kind: "line",
                source,
                entryId: entry.id,
                index,
                company: entry.company,
                role: entry.role,
                before: line,
                after,
                why: `Uses the posting's words: ${quoteList(terms)}.`,
            });
        });
    }
    return out;
}

/** The marker the entry's own lines use ("• ", "- "), so a rewritten entry keeps its look. */
function bulletMarkerOf(description: string): string {
    for (const line of description.split("\n")) {
        const m = line.match(BULLET_MARKER_RE);
        if (m) return `${m[0].trim()} `;
    }
    return "- ";
}

function applyToEntries(entries: ResumeExperience[], source: EntrySource, changes: TailorChange[]): ResumeExperience[] {
    return entries.map((entry) => {
        const mine = changes.filter((c) => (c.kind === "line" || c.kind === "order") && c.source === source && c.entryId === entry.id);
        if (mine.length === 0) return entry;
        let lines = descriptionToBullets(entry.description ?? "");
        const original = [...lines];
        for (const c of mine) {
            if (c.kind === "line" && original[c.index] === c.before) lines[c.index] = c.after;
        }
        const order = mine.find((c) => c.kind === "order");
        if (order?.kind === "order" && order.order.length === lines.length) lines = order.order.map((i) => lines[i]);
        if (lines.every((l, i) => l === original[i])) return entry;
        const marker = bulletMarkerOf(entry.description ?? "");
        return { ...entry, description: lines.map((l) => `${marker}${l}`).join("\n") };
    });
}

/** Pure: `base` with `changes` applied (a copy; `base` is left as it was). Undo a
 *  change by leaving it out: the others still apply. */
export function applyTailorChanges(base: ResumeData, changes: TailorChange[]): ResumeData {
    const out = cloneResume(base);
    for (const c of changes) if (c.kind === "summary") out.generatedSummary = c.after;
    out.experience = applyToEntries(out.experience ?? [], "experience", changes);
    if (out.projects) out.projects = applyToEntries(out.projects, "project", changes);
    const leftOut = (source: EntrySource, id: string) => changes.some((c) => c.kind === "leave-out" && c.source === source && c.entryId === id);
    out.experience = out.experience.filter((e) => !leftOut("experience", e.id));
    if (out.projects) out.projects = out.projects.filter((e) => !leftOut("project", e.id));
    for (const c of changes) {
        if (c.kind !== "skills") continue;
        const group = out.competencies[c.group];
        if (group && group.skills.length === c.after.length && group.skills.every((s, i) => s === c.before[i])) {
            out.competencies[c.group] = { ...group, skills: c.after };
        }
    }
    return out;
}

/** The draft's derived fields (`tailored`, `bullets`, `summaryAfter`) from its base and changes. */
export function finishDraft(draft: TailorDraft): TailorDraft {
    const on = draft.changes.filter(startsOn);
    const summary = on.find((c) => c.kind === "summary");
    return {
        ...draft,
        summaryAfter: summary?.kind === "summary" ? summary.after : draft.summaryBefore,
        bullets: on.flatMap((c) =>
            c.kind === "line"
                ? [{ experienceId: c.entryId, source: c.source, company: c.company, role: c.role, before: c.before, after: c.after }]
                : [],
        ),
        tailored: applyTailorChanges(draft.base, on),
    };
}

/** Rewords the résumé in the posting's words (summary and every experience and
 *  project line); ordering is `withRoleOrder`. */
export function heuristicTailorResume(resume: ResumeData, job: TailorJobInput): TailorDraft {
    const base = cloneResume(resume);
    const posting = postingTextFor(job);
    const wording = readPostingWording(posting);
    const acronymsDone = new Set<string>();
    const summary = summaryChange(base, job, wording, acronymsDone);
    const changes: TailorChange[] = [
        ...(summary ? [summary] : []),
        ...lineChangesFor(base.experience ?? [], "experience", wording, acronymsDone),
        ...lineChangesFor(base.projects ?? [], "project", wording, acronymsDone),
    ];
    return finishDraft({
        engineId: "heuristic",
        engineLabel: ENGINE_LABELS.heuristic,
        usedDescription: Boolean(job.description?.trim()),
        summaryBefore: base.generatedSummary?.trim() ?? "",
        summaryAfter: base.generatedSummary?.trim() ?? "",
        bullets: [],
        base,
        changes,
        equivalents: equivalentWords(resumeFullText(base), posting),
        tailored: base,
    });
}

/**
 * Adds the moves to a (grounded) draft: in each role, the lines that use the
 * posting's words first; in each skills group, the skills the posting names
 * first, spelled the way the posting spells them. Pure reorders and spellings
 * of words already on the résumé, so they need no grounding.
 */
export function withRoleOrder(draft: TailorDraft, job: TailorJobInput): TailorDraft {
    const terms = roleTermsForJob(job);
    const wording = readPostingWording(postingTextFor(job));
    const changes: TailorChange[] = [...draft.changes];
    for (const move of lineOrders(draft.tailored, terms)) {
        changes.push({
            id: `order:${move.source}:${move.entryId}`,
            kind: "order",
            ...move,
            why: "Lines that use the posting's words now come first.",
        });
    }
    const groups = new Map(skillOrders(draft.base, terms).map((m) => [m.group, m]));
    draft.base.competencies.forEach((group, index) => {
        const moved = groups.get(index);
        const ordered = moved?.after ?? group.skills;
        const spelled = ordered.map((skill) => respell(skill, wording).after);
        const respelled = spelled.some((s, i) => s !== ordered[i]);
        if (!moved && !respelled) return;
        changes.push({
            id: `skills:${index}`,
            kind: "skills",
            group: index,
            category: group.category,
            before: group.skills,
            after: spelled,
            why: [moved ? "Skills the posting names now come first." : "", respelled ? "Spelled the way the posting spells them." : ""]
                .filter(Boolean)
                .join(" "),
        });
    });
    return finishDraft({ ...draft, changes });
}

/** Extract digit runs for truthfulness checks (model output validation). */
export function extractDigitRuns(text: string): string[] {
    return text.match(/\d+/g) ?? [];
}

export function introducesNewNumbers(original: string, rewritten: string): boolean {
    const orig = new Set(extractDigitRuns(original));
    return extractDigitRuns(rewritten).some((n) => !orig.has(n));
}
