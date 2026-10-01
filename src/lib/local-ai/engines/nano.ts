/**
 * Chrome built-in Prompt API / Gemini Nano (window.ai.languageModel).
 */

import type { ModelLoadReport } from "../model-load";
import type { LocalAiEngine, ModelParseOutput } from "./types";

const PARSE_PROMPT = (text: string) => `Extract resume data as JSON only. Fields: profile (name, profession, yearsOfExperience, location, email, phone, linkedin), experience (company, role, dates, description), competencies (category, skills array), education (degree, institution, year), generatedSummary.

RESUME:
"""
${text.slice(0, 6000)}
"""

Return ONLY valid JSON matching this shape:
{"profile":{},"experience":[],"competencies":[],"education":[],"generatedSummary":""}`;

type NanoSession = {
    prompt(input: string): Promise<string>;
    clone?: () => Promise<NanoSession>;
    destroy?: () => void;
};

type LanguageModelFactory = {
    create(options?: {
        temperature?: number;
        monitor?: (m: EventTarget) => void;
    }): Promise<NanoSession>;
    capabilities?: () => Promise<{ available: string }>;
};

async function nanoAvailability(): Promise<string | null> {
    const factory = getLanguageModelFactory();
    if (!factory?.capabilities) return null;
    try {
        return (await factory.capabilities()).available;
    } catch {
        return null;
    }
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

export const nanoEngine: LocalAiEngine = {
    id: "nano",
    downloadBytes: null,

    async isCached() {
        return (await nanoAvailability()) === "readily";
    },

    async isAvailable() {
        const factory = getLanguageModelFactory();
        if (!factory) return false;
        try {
            if (factory.capabilities) {
                const caps = await factory.capabilities();
                return caps.available === "readily" || caps.available === "after-download";
            }
            return true;
        } catch {
            return false;
        }
    },

    async init(report?: ModelLoadReport) {
        const factory = getLanguageModelFactory();
        if (!factory) throw new Error("Prompt API unavailable");
        session = await factory.create({
            temperature: 0.1,
            monitor: (m) =>
                m.addEventListener("downloadprogress", (e) => {
                    const { loaded, total } = e as Event & { loaded: number; total: number };
                    // loaded/total is a fraction whether Chrome reports bytes or a 0..1 value.
                    if (total > 0) report?.({ kind: "fraction", fraction: loaded / total });
                }),
        });
    },

    async parseResumeText(text: string) {
        if (!session) await this.init();
        const out = await session!.prompt(PARSE_PROMPT(text));
        return tryParseJson(out);
    },

    async generate(prompt: string) {
        if (!session) await this.init();
        // A Prompt API session is a conversation: prompting the shared one
        // again and again piles every earlier job into its context window
        // until it overflows. Each call gets its own copy, then drops it.
        const call = session!.clone ? await session!.clone() : session!;
        try {
            return await call.prompt(prompt);
        } finally {
            if (call !== session) call.destroy?.();
        }
    },

    getDisplayLabel() {
        return "On-device · Nano";
    },
};
