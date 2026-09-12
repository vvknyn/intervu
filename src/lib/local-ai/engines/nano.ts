/**
 * Chrome built-in Prompt API / Gemini Nano (window.ai.languageModel).
 */

import type { LocalAiEngine, ModelParseOutput } from "./types";

const PARSE_PROMPT = (text: string) => `Extract resume data as JSON only. Fields: profile (name, profession, yearsOfExperience, location, email, phone, linkedin), experience (company, role, dates, description), competencies (category, skills array), education (degree, institution, year), generatedSummary.

RESUME:
"""
${text.slice(0, 6000)}
"""

Return ONLY valid JSON matching this shape:
{"profile":{},"experience":[],"competencies":[],"education":[],"generatedSummary":""}`;

type LanguageModelFactory = {
    create(options?: { temperature?: number }): Promise<{
        prompt(input: string): Promise<string>;
        destroy?: () => void;
    }>;
    capabilities?: () => Promise<{ available: string }>;
};

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

let session: { prompt(input: string): Promise<string>; destroy?: () => void } | null = null;

export const nanoEngine: LocalAiEngine = {
    id: "nano",

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

    async init() {
        const factory = getLanguageModelFactory();
        if (!factory) throw new Error("Prompt API unavailable");
        session = await factory.create({ temperature: 0.1 });
    },

    async parseResumeText(text: string) {
        if (!session) await this.init();
        const out = await session!.prompt(PARSE_PROMPT(text));
        return tryParseJson(out);
    },

    async generate(prompt: string) {
        if (!session) await this.init();
        return session!.prompt(prompt);
    },

    getDisplayLabel() {
        return "On-device · Nano";
    },
};
