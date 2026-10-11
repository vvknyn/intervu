/**
 * Customize résumé's tailor: the rules draft (tailor-resume.ts) and, when the
 * person allowed on-device AI, the on-device model's rewrites on top of it,
 * one line at a time (`tailorWithModel`). Never calls a hosted model: Vivek
 * 2026-10-10 chose on-device only.
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
    introducesNewNumbers,
    resumeFullText,
    withRoleOrder,
    type TailorChange,
    type TailorDraft,
    type TailorJobInput,
} from "./tailor-resume";
import { ENGINE_LABELS, type GenerateOptions, type LocalAiEngineId } from "./engines/types";
import { groundDraft, resumeWordSet, ungroundedWords } from "./tailor-ground";
import { lineAsks, postingAsks, withLeaveOuts, wordKey, type LineAsk, type PostingAsk } from "./tailor-asks";
import type { ResumeData } from "@/types/resume";

export type Generate = (prompt: string, options?: GenerateOptions) => Promise<string | null>;

/** Lines the model rewrites per draft, strongest matches first, and per role. */
const MODEL_LINES_MAX = 8;
const MODEL_LINES_PER_ENTRY = 3;
/** The WASM model is slow and weak: it rewrites only the strongest few. */
const WASM_LINES_MAX = 3;
/** The model starts no new line after this; what it already rewrote is kept. */
const MODEL_BUDGET_MS = 60_000;
const LINE_MAX_TOKENS = 90;
const SUMMARY_MAX_TOKENS = 160;
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

/** One line toward one ask: what a small model does well. */
export function linePrompt(pair: Pick<LineAsk, "line" | "ask">): string {
    const limit = Math.max(14, Math.round(wordCount(pair.line) * 1.4));
    return `Rewrite one line of a résumé so it answers a job posting.

The posting asks: "${pair.ask.text}"
The résumé line: "${pair.line}"

Rewrite the line so it leads with what the posting asks for, in the posting's words where the line already shows it.
Keep every fact, name and number in the line. Do not add a tool, employer, number, result or duty the line doesn't state.
Keep the line's tense. One sentence, at most ${limit} words. Reply with the rewritten line only.`;
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

export function summaryPrompt(summary: string, evidence: { ask: string; line: string }[]): string {
    return `Rewrite the summary at the top of a résumé for one job posting.

The posting asks for:
${evidence.map((e) => `- ${e.ask}`).join("\n")}

What the résumé shows for those:
${evidence.map((e) => `- ${e.line}`).join("\n")}

The current summary: "${summary}"

Rewrite the summary in at most 3 sentences and ${SUMMARY_WORDS_MAX} words that lead with what this posting asks for, using only facts from the current summary and the lines above. Keep the job title and years as written. Do not add a tool, employer, number or result. Reply with the summary only.`;
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
            ? `Rewritten on this device to answer the posting's ${quoteAsk(asks[0])}.`
            : `Rewritten on this device from your lines that answer ${asks.length} of the posting's asks.`;
    if (verdict.kind !== "confirm") return answers;
    const words = verdict.words.map((w) => `“${w}”`).join(", ");
    return `${answers} Adds the posting's ${words}: use it only if that's true.`;
}

/** In the browser console only: why a model's rewrite wasn't used, so a person
 *  checking the model on their own device can see what the gate caught. */
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
    budgetMs?: number;
    now?: () => number;
    /** Called before each model call: how many are done, of how many. */
    onProgress?: (done: number, total: number) => void;
}

/**
 * The rules draft, with the model's rewrites on top: each line that answers
 * one of the posting's asks (tailor-asks.ts) rewritten toward that ask, one
 * call per line, and the summary from the strongest of them. Each rewrite is
 * judged (`judgeRewrite`) and goes through the grounding gate; a line the
 * model didn't improve keeps the rules' wording.
 */
export async function tailorWithModel(
    resume: ResumeData,
    job: TailorJobInput,
    generate: Generate,
    opts: ModelTailorOptions,
): Promise<TailorDraft> {
    const now = opts.now ?? Date.now;
    const started = now();
    const fullText = resumeFullText(resume);
    const rules = groundDraft(fullText, heuristicTailorResume(resume, job));
    const asks = postingAsks(job.description ?? "");
    const matched = lineAsks(rules.base, asks);
    const pairs = pickPairs(matched, opts.maxLines ?? MODEL_LINES_MAX);
    const summaryBefore = rules.summaryBefore;
    const evidence = summaryBefore ? summaryEvidence(matched) : [];
    const total = pairs.length + (evidence.length > 0 ? 1 : 0);

    const resumeWords = new Set(fullText.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter(Boolean));
    const postingNames = new Set(namesOf(job.description ?? "").map((n) => n.toLowerCase()).filter((n) => !resumeWords.has(n)));
    const vocabulary = resumeWordSet(fullText, rules.equivalents);
    const all = [...rules.base.experience, ...(rules.base.projects ?? [])];
    const skillsText = rules.base.competencies.flatMap((c) => c.skills).join(" ");

    const modelChanges = new Map<string, TailorChange>();
    // A rewrite that needs the person's OK starts off, so it never replaces a
    // rewording the rules could already stand behind: that one stays on.
    const rulesChanged = new Set(rules.changes.map((c) => c.id));
    let done = 0;
    for (const pair of pairs) {
        if (now() - started > (opts.budgetMs ?? MODEL_BUDGET_MS)) break;
        opts.onProgress?.(done, total);
        const raw = await generate(linePrompt(pair), { temperature: 0.2, maxTokens: LINE_MAX_TOKENS });
        done++;
        const after = raw ? cleanModelLine(raw, pair.line) : null;
        if (!after) continue;
        const entry = all.find((e) => e.id === pair.entryId);
        const verdict = judgeRewrite(pair.line, after, {
            vocabulary,
            resumeWords,
            numbersFrom: pair.line,
            asks: [pair.ask],
            postingNames,
            otherEmployers: all.filter((e) => e !== entry && e.company !== entry?.company).map((e) => e.company.trim()),
            confirmMax: LINE_CONFIRM_MAX,
        });
        if (verdict.kind === "drop") {
            logDropped(pair.line, after, verdict.reason);
            continue;
        }
        const id = `line:${pair.source}:${pair.entryId}:${pair.index}`;
        if (verdict.kind === "confirm" && rulesChanged.has(id)) {
            logDropped(pair.line, after, "needs your OK; the rules rewording stays");
            continue;
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
    }

    if (evidence.length > 0 && now() - started <= (opts.budgetMs ?? MODEL_BUDGET_MS)) {
        opts.onProgress?.(done, total);
        const raw = await generate(summaryPrompt(summaryBefore, evidence), { temperature: 0.2, maxTokens: SUMMARY_MAX_TOKENS });
        const after = raw ? cleanModelLine(raw, summaryBefore) : null;
        const verdict = after
            ? judgeRewrite(summaryBefore, after, {
                  vocabulary,
                  resumeWords,
                  numbersFrom: [summaryBefore, ...evidence.map((e) => e.line), skillsText].join(" "),
                  asks: asks.filter((a) => evidence.some((e) => e.ask === a.text)),
                  postingNames,
                  otherEmployers: [],
                  confirmMax: SUMMARY_CONFIRM_MAX,
                  // A summary may grow from one sentence to three, drawing on the lines.
                  maxWords: Math.max(SUMMARY_WORDS_MAX, wordCount(summaryBefore) + 8),
              })
            : null;
        if (after && verdict?.kind === "drop") logDropped(summaryBefore, after, verdict.reason);
        else if (after && verdict?.kind === "confirm" && rulesChanged.has("summary")) {
            logDropped(summaryBefore, after, "needs your OK; the rules rewording stays");
        } else if (after && verdict && verdict.kind !== "drop") {
            modelChanges.set("summary", {
                id: "summary",
                kind: "summary",
                before: summaryBefore,
                after,
                why: whyFor(verdict, evidence.map((e) => e.ask)),
                ...(verdict.kind === "confirm" ? { confirm: verdict.words } : {}),
            });
        }
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
    return withLeaveOuts(withRoleOrder(groundDraft(resumeFullText(resume), heuristicTailorResume(resume, job)), job), job);
}

export async function tailorResumeForJob(
    resume: ResumeData,
    job: TailorJobInput,
    opts?: { allowModel?: boolean; onProgress?: (done: number, total: number) => void },
): Promise<TailorDraft> {
    if (!opts?.allowModel || !readLocalAiConsent()) return tailorWithRules(resume, job);
    await initLocalAiLadder();
    const engineId = getActiveEngineId();
    if (engineId === "heuristic") return tailorWithRules(resume, job);
    return tailorWithModel(resume, job, generateWithActiveEngine, {
        engineId,
        engineLabel: getActiveEngineLabel(),
        maxLines: engineId === "transformers" ? WASM_LINES_MAX : MODEL_LINES_MAX,
        onProgress: opts.onProgress,
    });
}

export { ENGINE_LABELS };
export { groundDraft, jobToTailorInput } from "./tailor-ground";
