/**
 * On-device AI job-description formatter.
 *
 * Goal: every For-you postcard (and any other consumer) reads the same
 * scannable template — not a raw ATS HTML dump — with light emoji section
 * markers. Pipeline:
 *
 *   1. Deterministic template (instant) — remaps formatDescription blocks
 *      into hook / do / bring / nice / perks. Always available; never empty
 *      a card that already had prose.
 *   2. On-device AI upgrade (async) — Nano → WebLLM → Transformers via the
 *      existing ladder + generateWithActiveEngine. Only when local-AI is
 *      enabled + consented. Cached per jobId + content hash so scrolling
 *      the deck does not re-prompt.
 *   3. Fail soft — AI miss / timeout / unavailable keeps the deterministic
 *      (or previously cached) template. Never blocks deck navigation.
 */

import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { readBrowserValue, writeBrowserValue } from "@/lib/jobs/browser-storage";
import { readLocalAiConsent } from "./consent";
import { readLocalAiEnabled } from "./flag";
import {
    generateWithActiveEngine,
    getActiveEngineId,
    initLocalAiLadder,
} from "./ladder";

export type JdTemplateKey = "hook" | "do" | "bring" | "nice" | "perks";

export interface JdTemplate {
    hook: DescBlock[];
    do: DescBlock[];
    bring: DescBlock[];
    nice: DescBlock[];
    perks: DescBlock[];
}

/** Section chrome — light emoji markers, Swiss/Klein quiet caps elsewhere. */
export const JD_TEMPLATE_LABELS: Record<JdTemplateKey, string> = {
    hook: "✨ The role",
    do: "🎯 What you'll do",
    bring: "🧠 What you bring",
    nice: "🌱 Nice to have",
    perks: "🎁 Perks",
};

/** Stable render order for the postcard. */
export const JD_TEMPLATE_ORDER: JdTemplateKey[] = ["hook", "do", "bring", "nice", "perks"];

const CACHE_PREFIX = "velai.jdFormat.v1:";
const CACHE_VERSION = 2;
const MAX_CACHE_ENTRIES = 48;
const AI_TIMEOUT_MS = 12_000;
/** Cap source text sent to the on-device model. */
const SOURCE_CHAR_CAP = 5_000;

type CachedEntry = {
    v: number;
    jobId: string;
    hash: string;
    template: JdTemplate;
    engine: string;
    at: number;
};

const memoryCache = new Map<string, CachedEntry>();
const inFlight = new Map<string, Promise<JdTemplate | null>>();

function emptyTemplate(): JdTemplate {
    return { hook: [], do: [], bring: [], nice: [], perks: [] };
}

export function jdTemplateHasContent(t: JdTemplate): boolean {
    return JD_TEMPLATE_ORDER.some((k) => t[k].length > 0);
}

/** Count non-empty template sections (hook/do/bring/nice/perks). */
export function jdTemplateFilledSectionCount(t: JdTemplate): number {
    return JD_TEMPLATE_ORDER.filter((k) => t[k].length > 0).length;
}

function templateCharCount(t: JdTemplate): number {
    let n = 0;
    for (const key of JD_TEMPLATE_ORDER) {
        for (const b of t[key]) {
            if (b.type === "list" && b.items) n += b.items.join(" ").length;
            else n += (b.text ?? "").length;
        }
    }
    return n;
}

/**
 * True when the template would render a sparse postcard (hook-only or almost
 * no recovered prose vs the source). Callers must soft-fail — never show a
 * huge empty "✨ The role" card.
 */
export function jdTemplateIsThin(t: JdTemplate, raw?: string | null): boolean {
    if (!jdTemplateHasContent(t)) return true;
    const filled = jdTemplateFilledSectionCount(t);
    const chars = templateCharCount(t);
    // Only a truncated hook → sparse card with empty whitespace beside fit aside.
    if (filled === 1 && t.hook.length > 0) return true;
    if (chars < 80) return true;
    const rawLen = (raw ?? "").replace(/\s+/g, " ").trim().length;
    if (rawLen >= 200 && chars / rawLen < 0.2 && filled < 3) return true;
    return false;
}

/**
 * Short search-index-style snippet for soft-fail postcard bodies when the
 * template is thin — never invent; just compress the source.
 */
export function jdSearchIndexSnippet(raw: string | null | undefined, max = 280): string {
    const cleaned = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    if (cleaned.length <= max) return cleaned;
    const slice = cleaned.slice(0, max - 1);
    const cut = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "), slice.lastIndexOf(", "), slice.lastIndexOf(" "));
    const base = cut > 80 ? slice.slice(0, cut + (slice[cut] === "." || slice[cut] === ";" ? 1 : 0)) : slice;
    return `${base.trim()}…`;
}

/** djb2-ish content hash — short, stable, good enough for cache keys. */
export function hashJobDescription(raw: string): string {
    let h = 5381;
    for (let i = 0; i < raw.length; i++) {
        h = ((h << 5) + h) ^ raw.charCodeAt(i);
    }
    return (h >>> 0).toString(36);
}

function cacheKey(jobId: string, hash: string): string {
    return `${CACHE_PREFIX}${jobId}:${hash}`;
}

function readCache(jobId: string, hash: string): JdTemplate | null {
    const key = cacheKey(jobId, hash);
    const mem = memoryCache.get(key);
    if (mem && mem.v === CACHE_VERSION && mem.hash === hash) return mem.template;

    const raw = readBrowserValue(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as CachedEntry;
        if (parsed?.v !== CACHE_VERSION || parsed.hash !== hash || !parsed.template) return null;
        memoryCache.set(key, parsed);
        return parsed.template;
    } catch {
        return null;
    }
}

function writeCache(jobId: string, hash: string, template: JdTemplate, engine: string): void {
    const key = cacheKey(jobId, hash);
    const entry: CachedEntry = {
        v: CACHE_VERSION,
        jobId,
        hash,
        template,
        engine,
        at: Date.now(),
    };
    memoryCache.set(key, entry);
    writeBrowserValue(key, JSON.stringify(entry));
    evictOldestCacheEntries();
}

function evictOldestCacheEntries(): void {
    if (typeof globalThis.localStorage === "undefined") return;
    try {
        const keys: { key: string; at: number }[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k?.startsWith(CACHE_PREFIX)) continue;
            try {
                const parsed = JSON.parse(localStorage.getItem(k) ?? "") as CachedEntry;
                keys.push({ key: k, at: parsed?.at ?? 0 });
            } catch {
                keys.push({ key: k, at: 0 });
            }
        }
        if (keys.length <= MAX_CACHE_ENTRIES) return;
        keys.sort((a, b) => a.at - b.at);
        for (const stale of keys.slice(0, keys.length - MAX_CACHE_ENTRIES)) {
            localStorage.removeItem(stale.key);
            memoryCache.delete(stale.key);
        }
    } catch {
        /* private mode / quota */
    }
}

const DO_HEADINGS = new Set([
    "responsibilities",
    "your role",
    "what you'll do",
    "what you'll be doing",
    "key responsibilities",
    "what your impact will be",
    "the role",
    "duties",
    "essential functions",
    "essential duties",
    "what success looks like",
    "your impact",
    "role overview",
]);

const BRING_HEADINGS = new Set([
    "requirements",
    "qualifications",
    "what we're looking for",
    "minimum qualifications",
    "your background",
    "what you bring",
    "required skills",
    "technical skills",
    "education",
    "experience",
    "education/experience",
    "who you are",
    "skills",
]);

const NICE_HEADINGS = new Set([
    "nice to have",
    "preferred qualifications",
    "preferred skills",
    "bonus",
    "bonus points",
    "preferred",
]);

const PERKS_HEADINGS = new Set([
    "what we offer",
    "benefits",
    "perks",
    "compensation",
    "why join",
    "our values",
    "pay range",
    "salary",
    "salary range",
    "compensation range",
]);

function normalizeHeading(text: string | undefined): string {
    return (text ?? "").toLowerCase().replace(/[:.!?]+$/, "").trim();
}

function classifyHeading(text: string | undefined): JdTemplateKey | "skip" | null {
    const key = normalizeHeading(text);
    if (!key) return null;
    // Skip EEO / legal / company-about walls — not the role template.
    if (
        key.includes("equal opportunity") ||
        key.includes("eeo") ||
        key === "about us" ||
        key === "about the company" ||
        key === "about the team" ||
        key === "the company" ||
        key === "the team" ||
        key === "company description" ||
        key === "additional information" ||
        key === "physical requirements" ||
        key === "work environment"
    ) {
        return "skip";
    }
    if (DO_HEADINGS.has(key)) return "do";
    if (NICE_HEADINGS.has(key)) return "nice";
    if (BRING_HEADINGS.has(key)) return "bring";
    if (PERKS_HEADINGS.has(key)) return "perks";
    if (key === "about the role" || key === "overview" || key === "summary" || key === "position summary" || key === "position purpose" || key === "the opportunity" || key === "job description") {
        return "hook";
    }
    return null;
}

function blockToProse(block: DescBlock): string {
    if (block.type === "list") return (block.items ?? []).join(" ");
    if (block.type === "para") {
        const lead = block.lead ? `${block.lead} ` : "";
        return `${lead}${block.text ?? ""}`.trim();
    }
    return (block.text ?? "").trim();
}

function firstSentence(text: string, max = 160): string {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    const m = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
    const sentence = (m?.[1] ?? cleaned).trim();
    if (sentence.length <= max) return sentence;
    return `${sentence.slice(0, max - 1).trim()}…`;
}

function toListBlocks(items: string[]): DescBlock[] {
    const cleaned = items.map((s) => s.replace(/^[-•*·]\s*/, "").trim()).filter((s) => s.length >= 2);
    if (!cleaned.length) return [];
    return [{ type: "list", items: cleaned }];
}

function collectListItems(blocks: DescBlock[]): string[] {
    const out: string[] = [];
    for (const b of blocks) {
        if (b.type === "list" && b.items) out.push(...b.items);
        else if (b.type === "para" && b.text) {
            // Split glued " - Item" prose into bullets when possible.
            const parts = b.text.split(/\n|(?:^|\s)[-•*·]\s+/).map((p) => p.trim()).filter(Boolean);
            if (parts.length > 1) out.push(...parts);
            else out.push(b.text.trim());
        }
    }
    return out.filter((s) => s.length >= 2);
}

/**
 * Instant, deterministic remapping into the shared template shape.
 * Prefer this as the baseline so every card shares section chrome even
 * when on-device AI is off / slow / unavailable.
 */
export function buildDeterministicJdTemplate(raw: string | null | undefined): JdTemplate {
    if (!raw?.trim()) return emptyTemplate();
    const blocks = formatDescription(raw);
    const out = emptyTemplate();
    let current: JdTemplateKey | "skip" = "hook";
    const hookParas: DescBlock[] = [];

    for (const block of blocks) {
        if (block.type === "heading") {
            const next = classifyHeading(block.text);
            if (next === "skip") {
                current = "skip";
                continue;
            }
            if (next) {
                current = next;
                continue;
            }
            // Unrecognized heading — keep accumulating under current bucket.
            continue;
        }
        if (current === "skip") continue;

        if (block.type === "para" && block.text) {
            const colon = block.text.match(/^([^:]{2,40}):\s*(.*)$/);
            if (colon) {
                const classified = classifyHeading(colon[1]);
                if (classified && classified !== "skip") {
                    current = classified;
                    const rest = (colon[2] ?? "").trim();
                    if (rest) {
                        if (current === "hook") hookParas.push({ type: "para", text: rest });
                        else out[current].push({ type: "para", text: rest });
                    }
                    continue;
                }
            }
            if (block.lead) {
                const classified = classifyHeading(block.lead.replace(/\.$/, ""));
                if (classified && classified !== "skip") current = classified;
            }
        }

        if (current === "hook") hookParas.push(block);
        else out[current].push(block);
    }

    // Hook = one-line pitch from the first about/hook prose.
    const hookJoined = hookParas.map(blockToProse).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const hookText = firstSentence(hookJoined);
    if (hookText) out.hook = [{ type: "para", text: hookText }];

    // Leftover hook body beyond the first sentence — previously we only kept
    // hookParas.slice(1), which discarded the rest of a single mega-paragraph
    // and produced hook-only sparse cards (Caseware / Workday flatten).
    if (out.do.length === 0 && hookJoined) {
        let rest = hookJoined;
        if (hookText) {
            const bare = hookText.replace(/…$/, "");
            if (rest.startsWith(bare)) rest = rest.slice(bare.length).replace(/^[.…\s]+/, "").trim();
            else rest = rest.replace(/^.+?[.!?](?:\s+|$)/, "").trim();
        }
        const leftover: string[] = [];
        for (const b of hookParas) {
            if (b.type === "list" && b.items) leftover.push(...b.items);
        }
        if (rest) {
            const sentences = rest.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 12);
            leftover.push(...(sentences.length ? sentences : [rest]));
        }
        if (leftover.length) out.do = toListBlocks(leftover.slice(0, 8));
    }

    // Normalize do/bring/nice/perks to list blocks when we only have paras.
    for (const key of ["do", "bring", "nice", "perks"] as const) {
        if (out[key].length === 0) continue;
        if (out[key].every((b) => b.type === "list")) continue;
        const items = collectListItems(out[key]);
        if (items.length) out[key] = toListBlocks(items.slice(0, 10));
    }

    // Always prefer a one-line hook. If the ATS dump jumped straight into
    // requirements with no About, synthesize from the first available prose
    // so every postcard still opens with the same template shape.
    if (out.hook.length === 0) {
        const fromBuckets = [...out.do, ...out.bring, ...out.nice, ...out.perks]
            .map(blockToProse)
            .find((s) => s.length >= 12);
        const fallback = firstSentence(
            fromBuckets || raw.replace(/\s+/g, " ").trim(),
            200,
        );
        if (fallback) out.hook = [{ type: "para", text: fallback }];
    }

    // If we somehow produced nothing but the source had text, keep a single
    // hook so the card never goes empty.
    if (!jdTemplateHasContent(out)) {
        const fallback = firstSentence(raw.replace(/\s+/g, " ").trim(), 200);
        if (fallback) out.hook = [{ type: "para", text: fallback }];
    }

    return out;
}

type ModelJdOutput = {
    hook?: string;
    do?: string[];
    bring?: string[];
    nice?: string[];
    perks?: string[];
};

function tryParseModelJson(text: string): ModelJdOutput | null {
    const trimmed = text.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
        return JSON.parse(trimmed.slice(start, end + 1)) as ModelJdOutput;
    } catch {
        return null;
    }
}

export function buildJdFormatPrompt(raw: string): string {
    const source = raw.replace(/\s+/g, " ").trim().slice(0, SOURCE_CHAR_CAP);
    return `Rewrite this job posting into a consistent scannable template. Return JSON only — no markdown fences, no commentary.

Shape:
{"hook":"one sentence role pitch","do":["bullet",...],"bring":["bullet",...],"nice":["bullet",...],"perks":["bullet",...]}

Rules:
- hook: ONE sentence. No company name, salary, or location (shown elsewhere).
- do: 3–6 concrete "what you'll do" bullets from the source.
- bring: 3–6 must-have qualifications from the source.
- nice: 0–4 preferred/nice-to-haves; use [] if none.
- perks: 0–4 benefits/perks; use [] if none. Omit salary figures.
- Preserve facts — do NOT invent skills, years, or perks.
- Short bullets. No emoji inside strings. No section labels inside strings.

SOURCE:
"""
${source}
"""`;
}

function modelToTemplate(model: ModelJdOutput, fallback: JdTemplate): JdTemplate {
    const out = emptyTemplate();
    const hook = model.hook?.trim();
    if (hook) out.hook = [{ type: "para", text: firstSentence(hook, 200) }];
    else out.hook = fallback.hook;

    const mapList = (arr: string[] | undefined, fb: DescBlock[]): DescBlock[] => {
        if (!arr || !Array.isArray(arr)) return fb;
        const items = arr.map((s) => String(s).trim()).filter((s) => s.length >= 2).slice(0, 10);
        return items.length ? toListBlocks(items) : fb;
    };

    out.do = mapList(model.do, fallback.do);
    out.bring = mapList(model.bring, fallback.bring);
    out.nice = mapList(model.nice, fallback.nice);
    out.perks = mapList(model.perks, fallback.perks);

    return jdTemplateHasContent(out) ? out : fallback;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("jd-format timeout")), ms);
        promise.then(
            (v) => {
                clearTimeout(timer);
                resolve(v);
            },
            (e) => {
                clearTimeout(timer);
                reject(e);
            },
        );
    });
}

export function canUseOnDeviceJdFormat(): boolean {
    return readLocalAiEnabled() && readLocalAiConsent();
}

/**
 * Try on-device AI rewrite. Returns null on any failure so callers keep the
 * deterministic template. Dedupes in-flight work per jobId+hash.
 */
export async function enhanceJdTemplateWithLocalAi(
    jobId: string,
    raw: string,
    fallback: JdTemplate,
): Promise<JdTemplate | null> {
    if (!raw.trim() || !canUseOnDeviceJdFormat()) return null;

    const hash = hashJobDescription(raw);
    const cached = readCache(jobId, hash);
    if (cached && !jdTemplateIsThin(cached, raw)) return cached;

    const key = cacheKey(jobId, hash);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const work = (async (): Promise<JdTemplate | null> => {
        try {
            await initLocalAiLadder();
            const prompt = buildJdFormatPrompt(raw);
            const rawOut = await withTimeout(generateWithActiveEngine(prompt), AI_TIMEOUT_MS);
            if (!rawOut) return null;
            const parsed = tryParseModelJson(rawOut);
            if (!parsed) return null;
            const template = modelToTemplate(parsed, fallback);
            // Soft-fail thin AI output — keep the richer deterministic baseline.
            if (jdTemplateIsThin(template, raw) && !jdTemplateIsThin(fallback, raw)) {
                return null;
            }
            if (jdTemplateIsThin(template, raw)) return null;
            writeCache(jobId, hash, template, getActiveEngineId());
            return template;
        } catch (e) {
            console.warn("[local-ai] jd format failed", e);
            return null;
        } finally {
            inFlight.delete(key);
        }
    })();

    inFlight.set(key, work);
    return work;
}

/** Sync path: cache hit or deterministic template. Never throws. */
export function resolveJdTemplateSync(
    jobId: string | null | undefined,
    raw: string | null | undefined,
): { template: JdTemplate; source: "cache" | "deterministic" | "empty" } {
    if (!raw?.trim()) return { template: emptyTemplate(), source: "empty" };
    const hash = hashJobDescription(raw);
    const deterministic = buildDeterministicJdTemplate(raw);
    if (jobId) {
        const cached = readCache(jobId, hash);
        // Prefer cached only when it is at least as rich as deterministic —
        // never resurrect a thin hook-only AI cache into the postcard.
        if (cached && !jdTemplateIsThin(cached, raw)) {
            return { template: cached, source: "cache" };
        }
    }
    return { template: deterministic, source: "deterministic" };
}

/** Test helper — clears memory + in-flight maps (not localStorage). */
export function resetJdFormatCacheForTests(): void {
    memoryCache.clear();
    inFlight.clear();
}
