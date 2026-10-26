/**
 * Customize résumé's tailor: the rules draft (tailor-resume.ts) and, when
 * sealed AI is set up (src/lib/sealed-ai/client.ts), a model's rewrites on top
 * of it. Every line that answers one of the posting's asks, and the summary,
 * go in ONE request (`batchPrompt`): the instructions are sent once, only the
 * matched lines and their asks are sent (never the whole résumé or posting,
 * and never a name or contact detail), and each reply is capped to the words
 * it may have. Vivek 2026-10-11: "remember to optimize the token usage".
 */

import { sealedAiStatus, sealedChat } from "@/lib/sealed-ai/client";
import {
    finishDraft,
    heuristicTailorResume,
    introducesNewNumbers,
    resumeFullText,
    withRoleOrder,
    type TailorChange,
    type TailorDraft,
    type TailorJobInput,
} from "./tailor-resume";
import { ENGINE_LABELS, type LocalAiEngineId } from "./engines/types";
import { groundDraft, resumeWordSet, ungroundedWords } from "./tailor-ground";
import { rulesTailorDraft } from "./tailor-rules";
import { lineAsks, postingAsks, withLeaveOuts, wordKey, type LineAsk, type PostingAsk } from "./tailor-asks";
import type { ResumeData } from "@/types/resume";

export interface GenerateOptions {
    /** Cap on the reply: the words every item may have, in tokens. */
    maxTokens: number;
    temperature?: number;
}

export type Generate = (prompt: string, options: GenerateOptions) => Promise<string | null>;

/** Lines the model rewrites per draft, strongest matches first, and per role. */
const MODEL_LINES_MAX = 8;
const MODEL_LINES_PER_ENTRY = 3;
/** No second request starts after this; what the first rewrote is kept. */
const MODEL_BUDGET_MS = 60_000;
/** Requests per draft: the second asks again only for what the first got
 *  wrong (dropped by the gate, or missing), at a higher temperature. */
const MODEL_ROUNDS = 2;
/** At most this many of the posting's words a line rewrite may add for the person
 *  to confirm (the summary: `SUMMARY_CONFIRM_MAX`); more is a new sentence, dropped. */
const LINE_CONFIRM_MAX = 4;
const SUMMARY_CONFIRM_MAX = 6;
const SUMMARY_ASKS = 3;
/** Longest summary a rewrite may give: three short sentences. */
const SUMMARY_WORDS_MAX = 50;

/** Words a model's rewrite may add that join a line and claim nothing ("…a
 *  transition serving 950K users", "…spanning 6 regions"). */
const GLUE_WORDS = ["serving", "spanning", "covering", "alongside", "together", "whilst"];
/** Verbs for doing a task at all, which a rewrite may take from the ask it
 *  answers: "Cared for patients, including wound care" → "Provided wound care". */
const FRAMING_VERBS = ["provide", "provided", "providing", "provides", "perform", "performed", "performing", "performs", "conduct", "conducted", "conducting", "conducts", "handle", "handled", "handling", "handles"];

const WORDS_RE = /\p{L}[\p{L}\p{N}'’.+#-]*[\p{L}\p{N}+#]|\p{L}/gu;
const wordCount = (text: string) => text.match(WORDS_RE)?.length ?? 0;

/** One part of the résumé in a batch: a line ("1", "2", …) or the summary ("s"). */
export interface BatchItem {
    id: string;
    text: string;
    /** What the posting asks that this text answers. */
    asks: string[];
    /** The summary only: lines it may draw facts from. */
    shows?: string[];
    /** Most words the rewrite may have. */
    max: number;
}

/** Most words a line's rewrite may have: a little room to lead with the ask. */
export const lineWordLimit = (line: string) => Math.max(14, Math.round(wordCount(line) * 1.4));

/**
 * Every line and the summary in one prompt: the rules once, then one compact
 * JSON row per item. The reply is one JSON object keyed by item id.
 */
export function batchPrompt(items: BatchItem[]): string {
    const rows = items.map((item) =>
        JSON.stringify({
            id: item.id,
            asks: item.asks.length === 1 ? item.asks[0] : item.asks,
            ...(item.shows?.length ? { shows: item.shows } : {}),
            text: item.text,
            max: item.max,
        }),
    );
    const summary = items.some((item) => item.shows);
    return `Rewrite parts of a résumé so each answers what a job posting asks.

For each item:
- Lead with what "asks" names, in the posting's words where the text already shows it.
- Keep every fact, name and number. Add no tool, employer, number, result or duty the text doesn't state.
- If the text doesn't show what is asked, return it unchanged.
- Keep its tense. One sentence${summary ? ` (the summary, id "s": up to 3, and it may use facts from the lines in "shows")` : ""}, at most "max" words.

Items:
${rows.join("\n")}

Reply with JSON only, every item's id and its rewritten text: {"<id>": "<text>"}`;
}

/** The posting's strongest asks the résumé answers, with a line that answers each. */
function summaryEvidence(pairs: LineAsk[]): { ask: string; line: string }[] {
    const out: { ask: string; line: string }[] = [];
    const seen = new Set<number>();
    for (const pair of pairs) {
        if (seen.has(pair.ask.index)) continue;
        seen.add(pair.ask.index);
        out.push({ ask: pair.ask.text, line: pair.line });
        if (out.length >= SUMMARY_ASKS) break;
    }
    return out;
}

/** Tokens a batch's reply needs: each item's word limit, a little over, plus its id. */
export function batchMaxTokens(items: BatchItem[]): number {
    return items.reduce((sum, item) => sum + Math.ceil(item.max * 1.6) + 8, 16);
}

/** The rewrites in a batch reply, by item id; empty when the reply isn't the JSON asked for. */
export function readBatchReply(raw: string): Map<string, string> {
    const out = new Map<string, string>();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return out;
    try {
        const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
        for (const [id, value] of Object.entries(parsed)) {
            if (typeof value === "string") out.set(id, value);
        }
    } catch {
        // Not the JSON asked for: nothing from this reply is used.
    }
    return out;
}

/** The rewrite out of a model's reply: its first real line, without a label,
 *  bullet or quotes, ending the way the résumé's line ends. Null when empty. */
export function cleanModelLine(raw: string, before: string): string | null {
    const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !/^(here(['’]s| is)|sure|okay|of course)\b.*:$/i.test(l));
    let text = (lines[0] ?? "")
        .replace(/^(rewritten( line| summary)?|summary|line|answer)\s*:\s*/i, "")
        .replace(/^[-•*]\s+/, "")
        .replace(/^["“'](.*)["”']$/, "$1")
        .replace(/\s+/g, " ")
        .trim();
    if (!text) return null;
    const endsWithStop = /[.!?]$/.test(before.trim());
    text = text.replace(/[.;,]+$/, "");
    return endsWithStop ? `${text}.` : text;
}

export type RewriteVerdict = { kind: "on" } | { kind: "confirm"; words: string[] } | { kind: "drop"; reason: string };

export interface RewriteContext {
    /** The résumé's words, connectives and the posting's same-meaning words (`resumeWordSet`). */
    vocabulary: Set<string>;
    /** Every word on the résumé, lowercased: a name the rewrite uses must be one of them. */
    resumeWords: Set<string>;
    /** Where the rewrite may take numbers from. */
    numbersFrom: string;
    /** The asks the rewrite answers: words from them are offered for the person to confirm. */
    asks: PostingAsk[];
    /** Words the posting writes with a capital (tools, products, places): never confirmable. */
    postingNames: Set<string>;
    /** The person's other employers: a line naming one moves a fact between jobs. */
    otherEmployers: string[];
    confirmMax: number;
    /** Longest the rewrite may be, in words; by default 1.6 times the line, or 8 words more. */
    maxWords?: number;
}

/** A framing verb the ask itself uses, in any form ("provided" when it asks to "provide wound care"). */
function framingVerbOfAsk(word: string, asks: PostingAsk[]): boolean {
    if (!FRAMING_VERBS.includes(word)) return false;
    const forms = FRAMING_VERBS.filter((f) => f.slice(0, 5) === word.slice(0, 5));
    return asks.some((ask) => forms.some((f) => new RegExp(`\\b${f}\\b`, "i").test(ask.text)));
}

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’.+#-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu;

/** Words written with a capital past the start of the text (and any with a
 *  capital inside: "GitHub", "AWS"): names of tools, products, places, employers.
 *  A figure ("950K+") is a number, checked as one. */
function namesOf(text: string): string[] {
    return [...text.matchAll(TOKEN_RE)]
        .filter((m, i) => /^\p{L}/u.test(m[0]) && (/\p{Lu}/u.test(m[0].slice(1)) || (i > 0 && /^\p{Lu}/u.test(m[0]))))
        .map((m) => m[0]);
}

/**
 * Whether a model's rewrite can be used: on when it says only what the résumé
 * says; offered for the person to confirm when it adds at most a few of the
 * posting's own words for the ask it answers; dropped when it adds a number,
 * a name (tool, product, employer, place) the résumé lacks, another of the
 * person's employers, or words from anywhere else, or when it is not a
 * rewrite of the line (the same, or far longer or shorter).
 */
export function judgeRewrite(before: string, after: string, ctx: RewriteContext): RewriteVerdict {
    const plain = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (plain(before) === plain(after)) return { kind: "drop", reason: "unchanged" };
    const b = wordCount(before);
    const a = wordCount(after);
    if (a > (ctx.maxWords ?? Math.max(b * 1.6, b + 8)) || a < b * 0.5) return { kind: "drop", reason: "length" };
    if (introducesNewNumbers(ctx.numbersFrom, after)) return { kind: "drop", reason: "number" };
    const lower = after.toLowerCase();
    if (ctx.otherEmployers.some((e) => e.length >= 3 && lower.includes(e.toLowerCase()))) return { kind: "drop", reason: "employer" };
    for (const name of namesOf(after)) {
        const parts = name.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter(Boolean);
        if (parts.some((p) => !ctx.resumeWords.has(p))) return { kind: "drop", reason: `name ${name}` };
    }
    const added = ungroundedWords(ctx.vocabulary, after).filter((w) => !GLUE_WORDS.includes(w) && !framingVerbOfAsk(w, ctx.asks));
    if (added.length === 0) return { kind: "on" };
    if (added.length > ctx.confirmMax) return { kind: "drop", reason: "too many new words" };
    for (const word of added) {
        if (ctx.postingNames.has(word)) return { kind: "drop", reason: `name ${word}` };
        const key = wordKey(word);
        const inAsk = ctx.asks.some((ask) => (key ? ask.keys.has(key) : false) || new RegExp(`\\b${word}\\b`, "i").test(ask.text));
        if (!inAsk) return { kind: "drop", reason: `word ${word}` };
    }
    return { kind: "confirm", words: added };
}

function quoteAsk(text: string): string {
    const ask = text.replace(/[.;:!?]+$/, "");
    return `“${ask.length > 90 ? `${ask.slice(0, 89).trimEnd()}…` : ask}”`;
}

/** Why a rewrite is offered, short: the ask a line answers (the summary
 *  answers several, each named on its lines), and the posting words it adds. */
function whyFor(verdict: RewriteVerdict, asks: string[]): string {
    const answers =
        asks.length === 1
            ? `Rewritten to answer the posting's ${quoteAsk(asks[0])}.`
            : `Rewritten from your lines that answer ${asks.length} of the posting's asks.`;
    if (verdict.kind !== "confirm") return answers;
    const words = verdict.words.map((w) => `“${w}”`).join(", ");
    return `${answers} Adds the posting's ${words}: use it only if that's true.`;
}

/** In the browser console only: why a model's rewrite wasn't used, so a person
 *  checking the rewrites can see what the gate caught. */
function logDropped(before: string, after: string, reason: string): void {
    if (typeof window !== "undefined" || process.env.TAILOR_DEBUG) console.info(`[tailor] model rewrite not used (${reason}):`, { before, after });
}

/** The lines the model rewrites: the strongest matches, a few per role, none too short to reword. */
function pickPairs(pairs: LineAsk[], max: number): LineAsk[] {
    const perEntry = new Map<string, number>();
    const out: LineAsk[] = [];
    for (const pair of pairs) {
        if (out.length >= max) break;
        if (wordCount(pair.line) < 4) continue;
        const key = `${pair.source}:${pair.entryId}`;
        const n = perEntry.get(key) ?? 0;
        if (n >= MODEL_LINES_PER_ENTRY) continue;
        perEntry.set(key, n + 1);
        out.push(pair);
    }
    return out;
}

export interface ModelTailorOptions {
    engineId: LocalAiEngineId;
    engineLabel: string;
    maxLines?: number;
    /** Requests per draft; default `MODEL_ROUNDS`. */
    rounds?: number;
    budgetMs?: number;
    now?: () => number;
    /** Called before each request: how many parts are settled, of how many. */
    onProgress?: (done: number, total: number) => void;
}

type Kept = { after: string; verdict: Exclude<RewriteVerdict, { kind: "drop" }> };

/** Fewer is better: a rewrite in the résumé's own words, then one that needs the fewest words confirmed. */
const cost = (verdict: Kept["verdict"]) => (verdict.kind === "on" ? 0 : verdict.words.length);

type Part = { item: BatchItem; before: string; judge: (after: string) => RewriteVerdict };

/**
 * The rules draft, with the model's rewrites on top: each line that answers
 * one of the posting's asks (tailor-asks.ts) rewritten toward that ask, and
 * the summary from the strongest of them, all in one request, then one more
 * for what the first got wrong. Each rewrite is judged (`judgeRewrite`) and
 * goes through the grounding gate; a line the model didn't improve keeps the
 * rules' wording.
 */
export async function tailorWithModel(
    resume: ResumeData,
    job: TailorJobInput,
    generate: Generate,
    opts: ModelTailorOptions,
): Promise<TailorDraft> {
    const now = opts.now ?? Date.now;
    const started = now();
    const outOfTime = () => now() - started > (opts.budgetMs ?? MODEL_BUDGET_MS);
    const fullText = resumeFullText(resume);
    const rules = groundDraft(fullText, heuristicTailorResume(resume, job));
    const asks = postingAsks(job.description ?? "");
    const matched = lineAsks(rules.base, asks);
    const pairs = pickPairs(matched, opts.maxLines ?? MODEL_LINES_MAX);
    const summaryBefore = rules.summaryBefore;
    const evidence = summaryBefore ? summaryEvidence(matched) : [];

    const resumeWords = new Set(fullText.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter(Boolean));
    const postingNames = new Set(namesOf(job.description ?? "").map((n) => n.toLowerCase()).filter((n) => !resumeWords.has(n)));
    const vocabulary = resumeWordSet(fullText, rules.equivalents);
    const all = [...rules.base.experience, ...(rules.base.projects ?? [])];
    const skillsText = rules.base.competencies.flatMap((c) => c.skills).join(" ");

    const parts = new Map<string, Part>();
    pairs.forEach((pair, i) => {
        const entry = all.find((e) => e.id === pair.entryId);
        const otherEmployers = all.filter((e) => e !== entry && e.company !== entry?.company).map((e) => e.company.trim());
        parts.set(String(i + 1), {
            item: { id: String(i + 1), text: pair.line, asks: [pair.ask.text], max: lineWordLimit(pair.line) },
            before: pair.line,
            judge: (after) =>
                judgeRewrite(pair.line, after, {
                    vocabulary,
                    resumeWords,
                    numbersFrom: pair.line,
                    asks: [pair.ask],
                    postingNames,
                    otherEmployers,
                    confirmMax: LINE_CONFIRM_MAX,
                }),
        });
    });
    if (evidence.length > 0) {
        const summaryAsks = asks.filter((a) => evidence.some((e) => e.ask === a.text));
        // A summary may grow from one sentence to three, drawing on the lines.
        const maxWords = Math.max(SUMMARY_WORDS_MAX, wordCount(summaryBefore) + 8);
        parts.set("s", {
            item: { id: "s", text: summaryBefore, asks: evidence.map((e) => e.ask), shows: evidence.map((e) => e.line), max: maxWords },
            before: summaryBefore,
            judge: (after) =>
                judgeRewrite(summaryBefore, after, {
                    vocabulary,
                    resumeWords,
                    numbersFrom: [summaryBefore, ...evidence.map((e) => e.line), skillsText].join(" "),
                    asks: summaryAsks,
                    postingNames,
                    otherEmployers: [],
                    confirmMax: SUMMARY_CONFIRM_MAX,
                    maxWords,
                }),
        });
    }

    const best = new Map<string, Kept>();
    const rounds = opts.rounds ?? MODEL_ROUNDS;
    for (let round = 0; round < rounds; round++) {
        // After the first request, ask again only for parts with nothing usable yet.
        const open = [...parts.values()].filter((p) => !best.has(p.item.id));
        if (open.length === 0 || (round > 0 && outOfTime())) break;
        opts.onProgress?.(parts.size - open.length, parts.size);
        const items = open.map((p) => p.item);
        const raw = await generate(batchPrompt(items), { maxTokens: batchMaxTokens(items), temperature: round === 0 ? 0.2 : 0.6 });
        const replies = raw ? readBatchReply(raw) : new Map<string, string>();
        for (const part of open) {
            const reply = replies.get(part.item.id);
            const after = reply ? cleanModelLine(reply, part.before) : null;
            if (!after) continue;
            const verdict = part.judge(after);
            if (verdict.kind === "drop") {
                logDropped(part.before, after, verdict.reason);
                continue;
            }
            const held = best.get(part.item.id);
            if (!held || cost(verdict) < cost(held.verdict)) best.set(part.item.id, { after, verdict });
        }
    }

    const modelChanges = new Map<string, TailorChange>();
    // A rewrite that needs the person's OK starts off, so it never replaces a
    // rewording the rules could already stand behind: that one stays on.
    const rulesChanged = new Set(rules.changes.map((c) => c.id));
    pairs.forEach((pair, i) => {
        const kept = best.get(String(i + 1));
        if (!kept) return;
        const { after, verdict } = kept;
        const id = `line:${pair.source}:${pair.entryId}:${pair.index}`;
        if (verdict.kind === "confirm" && rulesChanged.has(id)) {
            logDropped(pair.line, after, "needs your OK; the rules rewording stays");
            return;
        }
        modelChanges.set(id, {
            id,
            kind: "line",
            source: pair.source,
            entryId: pair.entryId,
            index: pair.index,
            company: pair.company,
            role: pair.role,
            before: pair.line,
            after,
            why: whyFor(verdict, [pair.ask.text]),
            ...(verdict.kind === "confirm" ? { confirm: verdict.words } : {}),
        });
    });
    const summary = best.get("s");
    if (summary?.verdict.kind === "confirm" && rulesChanged.has("summary")) {
        logDropped(summaryBefore, summary.after, "needs your OK; the rules rewording stays");
    } else if (summary) {
        modelChanges.set("summary", {
            id: "summary",
            kind: "summary",
            before: summaryBefore,
            after: summary.after,
            why: whyFor(summary.verdict, evidence.map((e) => e.ask)),
            ...(summary.verdict.kind === "confirm" ? { confirm: summary.verdict.words } : {}),
        });
    }

    if (modelChanges.size === 0) return tailorWithRules(resume, job);
    const changes = [...rules.changes.filter((c) => !modelChanges.has(c.id)), ...modelChanges.values()];
    // The words `judgeRewrite` lets a rewrite add without a claim pass the gate too.
    const framing = FRAMING_VERBS.filter((w) => framingVerbOfAsk(w, asks));
    const equivalents = [...rules.equivalents, ...GLUE_WORDS, ...framing];
    const draft = finishDraft({ ...rules, engineId: opts.engineId, engineLabel: opts.engineLabel, changes, equivalents });
    return withLeaveOuts(withRoleOrder(groundDraft(fullText, draft), job), job);
}

/** The rules draft, grounded and ordered, with projects the posting asks
 *  nothing about offered to leave out: what every no-model path gets. */
export function tailorWithRules(resume: ResumeData, job: TailorJobInput): TailorDraft {
    return rulesTailorDraft(resume, job);
}

/** The sealed model's rewrites when sealed AI is set up on this server, else the rules draft. */
export async function tailorResumeForJob(
    resume: ResumeData,
    job: TailorJobInput,
    opts?: { onProgress?: (done: number, total: number) => void },
): Promise<TailorDraft> {
    if (!(await sealedAiStatus()).enabled) return tailorWithRules(resume, job);
    return tailorWithModel(resume, job, (prompt, options) => sealedChat([{ role: "user", content: prompt }], options), {
        engineId: "sealed",
        engineLabel: ENGINE_LABELS.sealed,
        onProgress: opts?.onProgress,
    });
}

export { ENGINE_LABELS };
export { groundDraft, jobToTailorInput } from "./tailor-ground";
