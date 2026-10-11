/**
 * Chrome built-in Prompt API / Gemini Nano (`LanguageModel`; older Chrome:
 * `window.ai.languageModel`). Explainer: github.com/webmachinelearning/prompt-api.
 *
 * - Availability is `LanguageModel.availability()` ("available",
 *   "downloadable", "downloading", "unavailable"); `capabilities()` is the
 *   older name, kept for browsers that still have it. Chrome refuses Nano on
 *   hardware it can't run on: "unavailable" moves the ladder to the next engine
 *   before consent copy promises Nano.
 * - `temperature` is ignored on web pages (extensions only), so none is passed.
 * - A caller's JSON schema becomes `responseConstraint`, so the reply parses.
 */

import type { ModelLoadReport } from "../model-load";
import type { GenerateOptions, LocalAiEngine, ModelParseOutput } from "./types";

const PARSE_PROMPT = (text: string) => `Extract resume data as JSON only. Fields: profile (name, profession, yearsOfExperience, location, email, phone, linkedin), experience (company, role, dates, description), competencies (category, skills array), education (degree, institution, year), generatedSummary.

RESUME:
"""
${text.slice(0, 6000)}
"""

Return ONLY valid JSON matching this shape:
{"profile":{},"experience":[],"competencies":[],"education":[],"generatedSummary":""}`;

type NanoSession = {
    prompt(input: string, options?: { responseConstraint?: Record<string, unknown> }): Promise<string>;
    clone?: () => Promise<NanoSession>;
    destroy?: () => void;
};

type InitialPrompt = { role: "system" | "user" | "assistant"; content: string };

type LanguageModelFactory = {
    create(options?: { initialPrompts?: InitialPrompt[]; monitor?: (m: EventTarget) => void }): Promise<NanoSession>;
    availability?: () => Promise<string>;
    /** Older Chrome: "readily" / "after-download" / "no". */
    capabilities?: () => Promise<{ available: string }>;
};

/** What Chrome says about Nano on this device, in the current API's words:
 *  "available", "downloadable", "downloading" or "unavailable". Null when the
 *  page can't ask (a factory with only `create`, as tests stub it). */
async function nanoAvailability(): Promise<string | null> {
    const factory = getLanguageModelFactory();
    try {
        if (factory?.availability) return await factory.availability();
        if (factory?.capabilities) {
            const legacy = (await factory.capabilities()).available;
            return legacy === "readily" ? "available" : legacy === "after-download" ? "downloadable" : "unavailable";
        }
    } catch {
        return "unavailable";
    }
    return null;
}

function getLanguageModelFactory(): LanguageModelFactory | null {
    if (typeof window === "undefined") return null;
    const w = window as Window & {
        ai?: { languageModel?: LanguageModelFactory };
        LanguageModel?: LanguageModelFactory;
    };
    return w.ai?.languageModel ?? w.LanguageModel ?? null;
}

function tryParseJson(text: string): ModelParseOutput {
    const trimmed = text.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

let session: NanoSession | null = null;
let reportLoad: ModelLoadReport | undefined;
/** Sessions primed with a caller's worked examples, one per set (`GenerateOptions.examples`). */
const primed = new Map<string, Promise<NanoSession>>();

function monitorDownload(m: EventTarget) {
    m.addEventListener("downloadprogress", (e) => {
        const { loaded, total } = e as Event & { loaded: number; total: number };
        // loaded/total is a fraction whether Chrome reports bytes or a 0..1 value.
        if (total > 0) reportLoad?.({ kind: "fraction", fraction: loaded / total });
    });
}

function primedSession(examples: NonNullable<GenerateOptions["examples"]>): Promise<NanoSession> {
    const key = JSON.stringify(examples);
    let made = primed.get(key);
    if (!made) {
        const initialPrompts: InitialPrompt[] = examples.flatMap((e) => [
            { role: "user" as const, content: e.prompt },
            { role: "assistant" as const, content: e.reply },
        ]);
        made = getLanguageModelFactory()!.create({ initialPrompts, monitor: monitorDownload });
        made.catch(() => primed.delete(key));
        primed.set(key, made);
    }
    return made;
}

/** A Chrome that can't honour the constraint rejects with NotSupportedError or TypeError: ask again without it. */
async function promptWith(call: NanoSession, prompt: string, schema?: Record<string, unknown>): Promise<string> {
    if (!schema) return call.prompt(prompt);
    try {
        return await call.prompt(prompt, { responseConstraint: schema });
    } catch (e) {
        const name = (e as { name?: string })?.name;
        if (name === "NotSupportedError" || name === "TypeError") return call.prompt(prompt);
        throw e;
    }
}

export function resetNanoForTests(): void {
    session = null;
    reportLoad = undefined;
    primed.clear();
}

export const nanoEngine: LocalAiEngine = {
    id: "nano",
    downloadBytes: null,

    async isCached() {
        return (await nanoAvailability()) === "available";
    },

    async isAvailable() {
        if (!getLanguageModelFactory()) return false;
        // Null (a factory that offers only `create`) lets create() decide.
        return (await nanoAvailability()) !== "unavailable";
    },

    async init(report?: ModelLoadReport) {
        const factory = getLanguageModelFactory();
        if (!factory) throw new Error("Prompt API unavailable");
        reportLoad = report;
        session = await factory.create({ monitor: monitorDownload });
    },

    async parseResumeText(text: string) {
        if (!session) await this.init();
        const out = await session!.prompt(PARSE_PROMPT(text));
        return tryParseJson(out);
    },

    async generate(prompt: string, options?: GenerateOptions) {
        if (!session) await this.init();
        // A Prompt API session is a conversation: prompting the shared one
        // again and again piles every earlier job into its context window
        // until it overflows. Each call gets its own copy, then drops it.
        const base = options?.examples?.length ? await primedSession(options.examples) : session!;
        const call = base.clone ? await base.clone() : base;
        try {
            return await promptWith(call, prompt, options?.schema);
        } finally {
            if (call !== base) call.destroy?.();
        }
    },

    getDisplayLabel() {
        return "On-device · Nano";
    },
};
