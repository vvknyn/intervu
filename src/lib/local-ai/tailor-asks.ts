/**
 * What a posting asks for, and which résumé line is evidence for each ask.
 *
 * A small on-device model rewrites one sentence toward one clear ask well and
 * a whole résumé badly, so the model step (tailor-with-engine.ts) is handed
 * one pair at a time: a line, and the posting sentence it answers. The pairing
 * itself is plain word matching, the same on every device: a line answers an
 * ask when they share the words that carry meaning (any form or spelling of
 * them: "migrated" / "migration", "organisation" / "organization"), or one
 * such word and a verb from the same near-synonym group ("Charted" /
 * "document").
 *
 * The same pairing says which projects the posting asks nothing about
 * (`withLeaveOuts`): each is offered to leave off this version.
 */
import { descriptionToBullets } from "@/lib/resume/merge-bullet-lines";
import type { ResumeData } from "@/types/resume";
import { wordStem } from "./tailor-ground";
import { finishDraft, type TailorChange, type TailorDraft, type TailorJobInput } from "./tailor-resume";
import { spellingKey, verbGroupOf } from "./tailor-wording";

/** One sentence or bullet of the posting that asks for something. */
export interface PostingAsk {
    /** Its place among the posting's asks. */
    index: number;
    text: string;
    /** Its meaning-carrying words, one key per word however it is spelled or inflected (`wordKey`). */
    keys: Set<string>;
    /** The near-synonym verb groups it uses (`verbGroupOf`). */
    verbs: Set<number>;
}

/** A résumé line and the ask it is best evidence for. */
export interface LineAsk {
    source: "experience" | "project";
    entryId: string;
    company: string;
    role: string;
    /** The line's place among the entry's lines (`descriptionToBullets`). */
    index: number;
    line: string;
    ask: PostingAsk;
    /** The words they share, as the line writes them. */
    shared: string[];
    score: number;
}

/** A sentence about what the employer offers, who they are or how to apply: not an ask. */
const NOT_AN_ASK_RE =
    /\b(equal (opportunity|employment)|benefits?|salary|salaries|compensation|pay range|per hour|per annum|bonus|apply|applicants?|application|visa|sponsorship|accommodations?|disabilit|background check|we offer|perks|vacation|paid time off|pto|401\s?k|pension|insurance|dental|parental|about us|our mission|our values|diversity|inclusion|privacy|recruit|headquarter|founded in|employees (worldwide|globally))/i;

/** Words in almost every posting and résumé line: sharing one says nothing about a match. */
const GENERIC_WORDS = new Set([
    "ability", "able", "about", "across", "also", "areas", "based", "being", "best", "business", "company",
    "demonstrated", "desired", "different", "each", "ensure", "environment", "every", "excellent", "experience",
    "experienced", "familiarity", "good", "great", "have", "help", "high", "ideal", "ideally", "including",
    "knowledge", "level", "like", "looking", "make", "more", "must", "needed", "nice", "other", "plus",
    "preferred", "proficiency", "proficient", "proven", "related", "relevant", "required", "requirements",
    "responsibilities", "responsible", "role", "roles", "skill", "skills", "strong", "such", "team", "teams",
    "their", "them", "they", "this", "through", "track", "record", "understanding", "using", "various", "well",
    "will", "with", "within", "work", "working", "would", "year", "years", "your", "you'll", "we're", "what",
    "when", "where", "which", "while", "join", "joining", "candidate", "candidates", "position", "opportunity",
]);

const WORD_RE = /\p{L}[\p{L}\p{N}'’-]*/gu;
const ASKS_MAX = 40;
/** A line must share this much with an ask to be rewritten toward it: two
 *  meaning-carrying words, or one and a verb from the same group. */
const MATCH_MIN_SCORE = 2;
/** A project sharing this many meaning-carrying words with the posting is kept. */
const LEAVE_OUT_MAX_SHARED = 2;

/** One key per word however it is spelled or inflected; null for a short or generic word. */
export function wordKey(word: string): string | null {
    const lower = word.toLowerCase().replace(/[’']s$/, "");
    if (lower.length < 4 || GENERIC_WORDS.has(lower)) return null;
    return wordStem(spellingKey(lower));
}

function keysOf(text: string): Set<string> {
    const out = new Set<string>();
    for (const m of text.matchAll(WORD_RE)) {
        const key = wordKey(m[0]);
        if (key) out.add(key);
    }
    return out;
}

function verbsOf(text: string): Set<number> {
    const out = new Set<number>();
    for (const m of text.matchAll(WORD_RE)) {
        const group = verbGroupOf(m[0]);
        if (group !== null) out.add(group);
    }
    return out;
}

/** The posting's asks: its sentences and bullets, less headings and what it offers. */
export function postingAsks(description: string): PostingAsk[] {
    const pieces = description
        .split(/\n+|(?<=[.!?;])\s+(?=[\p{Lu}•\-*])|\s+[•·▪]\s+/u)
        .map((p) => p.replace(/^[\s•·▪*\-–—\d.)]+/u, "").trim())
        .filter(Boolean);
    const asks: PostingAsk[] = [];
    const seen = new Set<string>();
    for (const text of pieces) {
        const words = text.match(WORD_RE) ?? [];
        if (words.length < 4 || words.length > 45) continue;
        if (/:$/.test(text) || NOT_AN_ASK_RE.test(text)) continue;
        const keys = keysOf(text);
        if (keys.size < 2 || seen.has(text.toLowerCase())) continue;
        seen.add(text.toLowerCase());
        asks.push({ index: asks.length, text, keys, verbs: verbsOf(text) });
        if (asks.length >= ASKS_MAX) break;
    }
    return asks;
}

function bestAsk(line: string, asks: PostingAsk[]): { ask: PostingAsk; shared: string[]; score: number } | null {
    const lineWords = [...line.matchAll(WORD_RE)].map((m) => m[0]);
    const opening = lineWords[0] ? verbGroupOf(lineWords[0]) : null;
    let best: { ask: PostingAsk; shared: string[]; score: number } | null = null;
    for (const ask of asks) {
        const shared: string[] = [];
        const seen = new Set<string>();
        for (const word of lineWords) {
            const key = wordKey(word);
            if (key && ask.keys.has(key) && !seen.has(key)) {
                seen.add(key);
                shared.push(word);
            }
        }
        if (shared.length === 0) continue;
        const score = shared.length + (opening !== null && ask.verbs.has(opening) ? 1 : 0);
        if (score >= MATCH_MIN_SCORE && (!best || score > best.score)) best = { ask, shared, score };
    }
    return best;
}

/** Every résumé line with the ask it best answers, strongest first; lines that answer none are left out. */
export function lineAsks(resume: ResumeData, asks: PostingAsk[]): LineAsk[] {
    const out: LineAsk[] = [];
    const entries = [
        ...resume.experience.map((entry) => ({ source: "experience" as const, entry })),
        ...(resume.projects ?? []).map((entry) => ({ source: "project" as const, entry })),
    ];
    for (const { source, entry } of entries) {
        descriptionToBullets(entry.description ?? "").forEach((line, index) => {
            const match = bestAsk(line, asks);
            if (!match) return;
            out.push({ source, entryId: entry.id, company: entry.company, role: entry.role, index, line, ...match });
        });
    }
    return out.sort((a, b) => b.score - a.score);
}

/**
 * Offers to leave off this version each project the posting asks nothing about: none
 * of its lines answers an ask, and it shares at most one meaning-carrying
 * word with the posting's asks, title and tags. Never a job (a gap in work history reads worse than a
 * line that doesn't fit), and never the only entries a résumé has. Each
 * starts off (`startsOn`): word matching can't tell how much a project matters
 * to the person, so they decide.
 */
export function withLeaveOuts(draft: TailorDraft, job: TailorJobInput): TailorDraft {
    const projects = draft.base.projects ?? [];
    if (projects.length === 0 || draft.base.experience.length === 0) return draft;
    const asks = postingAsks(job.description ?? "");
    if (asks.length === 0) return draft;
    const answered = new Set(lineAsks({ ...draft.base, experience: [] }, asks).map((m) => m.entryId));
    const asked = new Set([...asks.flatMap((a) => [...a.keys]), ...keysOf([job.title, ...(job.tags ?? [])].join(" "))]);
    const changes: TailorChange[] = [...draft.changes];
    for (const project of projects) {
        if (answered.has(project.id)) continue;
        const own = keysOf([project.role, project.company, project.description].join(" "));
        if ([...own].filter((k) => asked.has(k)).length >= LEAVE_OUT_MAX_SHARED) continue;
        changes.push({
            id: `leave-out:project:${project.id}`,
            kind: "leave-out",
            source: "project",
            entryId: project.id,
            company: project.company,
            role: project.role,
            why: "Nothing in it is something this posting asks for. Leave it out to make room for what is.",
        });
    }
    return changes.length === draft.changes.length ? draft : finishDraft({ ...draft, changes });
}
