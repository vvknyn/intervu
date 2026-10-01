/**
 * On-device model pass for job-description layout.
 *
 * The model never writes the description. It reads the description's lines
 * (the same segments the rules label, lib/jobs/format-description.ts) and
 * answers one letter per line: H heading, B list item, P paragraph. The
 * page then lays out the ORIGINAL lines by those letters, and only on the
 * lines the rules had to guess (`sure` false), so pay, requirements and
 * every other fact reach the reader word for word whatever the model says.
 *
 * Runs through the shared task queue (run-task.ts), only on Nano or WebLLM
 * (the 0.5B WASM fallback labels worse than the rules), and remembers each
 * answer in this browser per description, so a posting is labelled once per
 * device rather than on every view.
 */

import { readBrowserValue, writeBrowserValue } from "@/lib/jobs/browser-storage";
import {
    buildDescriptionBlocks,
    labelSegments,
    segmentDescription,
    type DescBlock,
    type DescSegment,
    type SegmentLabel,
} from "@/lib/jobs/format-description";
import type { LocalAiEngineId } from "./engines/types";
import { localAiTaskReady, runLocalAiTask, type LocalAiTaskPriority } from "./run-task";

/** Bump when segmentation changes: cached letters index old segments. */
const CACHE_PREFIX = "velai.jdLayout.v1:";
const MAX_CACHE_ENTRIES = 300;
/** Lines sent to the model; the rest keep the rules' labels. */
const MAX_PROMPT_LINES = 60;
const LINE_CHAR_CAP = 150;
/** Too few guessed lines to be worth a model call. */
const MIN_GUESSED_LINES = 3;
export const DESCRIPTION_LAYOUT_ENGINES: readonly LocalAiEngineId[] = ["nano", "webllm"];

/** Model letter per segment; "." where it gave none. */
type ModelLetters = string;

const memoryCache = new Map<string, ModelLetters>();

/** djb2 — same scheme as format-job-description's cache keys. */
function hashDescription(raw: string): string {
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i);
    return (h >>> 0).toString(36);
}

function cacheKey(description: string): string {
    return `${CACHE_PREFIX}${hashDescription(description)}:${description.length}`;
}

export function readCachedDescriptionLayout(description: string): ModelLetters | null {
    const key = cacheKey(description);
    const hit = memoryCache.get(key) ?? readBrowserValue(key);
    if (hit) memoryCache.set(key, hit);
    return hit ?? null;
}

function writeCachedDescriptionLayout(description: string, letters: ModelLetters): void {
    const key = cacheKey(description);
    memoryCache.set(key, letters);
    writeBrowserValue(key, letters);
    evictOldEntries();
}

function evictOldEntries(): void {
    if (typeof globalThis.localStorage === "undefined") return;
    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
        }
        // localStorage keeps insertion order in every engine we ship to, so
        // the first keys are the oldest.
        for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_CACHE_ENTRIES))) {
            localStorage.removeItem(stale);
            memoryCache.delete(stale);
        }
    } catch {
        /* private mode / quota */
    }
}

export function buildDescriptionLayoutPrompt(segments: DescSegment[]): string {
    const lines = segments.slice(0, MAX_PROMPT_LINES).map((seg, i) => {
        const text = seg.text.length > LINE_CHAR_CAP ? `${seg.text.slice(0, LINE_CHAR_CAP - 1)}…` : seg.text;
        return `${i + 1} ${text}`;
    });
    return `Label each numbered line of this job posting with exactly one letter:
H = a section title (short, like "What you'll do" or "About the team")
B = one item of a list (a duty, skill, requirement or benefit)
P = a normal paragraph of sentences

Answer with one line per input line, in order, as "number letter", for example:
1 P
2 H
3 B
Write nothing else.

Posting lines:
${lines.join("\n")}`;
}

/** Letters from the model's answer, one per segment; "." where missing. */
export function parseDescriptionLayout(output: string, count: number): ModelLetters {
    const letters: string[] = new Array(count).fill(".");
    const re = /^[\s*]*(\d+)[\s*]*[:.)=-]?[\s*]*([HBP])\b/gim;
    for (const m of output.matchAll(re)) {
        const index = Number(m[1]) - 1;
        if (index >= 0 && index < count && letters[index] === ".") letters[index] = m[2]!.toUpperCase();
    }
    return letters.join("");
}

/** A line the model calls a heading must still look like one. */
function headingShaped(text: string): boolean {
    return text.length <= 90 && !/[.!?]\s+\S/.test(text) && !/[.,;]$/.test(text);
}

export interface LaidOutDescription {
    blocks: DescBlock[];
    /** The model moved at least one line away from the rules' layout. */
    changed: boolean;
}

/**
 * Rules' labels with the model's letters applied to the guessed lines only.
 * Letters that don't fit the segmentation (a stale cache) or that call most
 * guessed lines headings (a model that misread the task) are ignored.
 */
export function layOutWithModelLetters(description: string, letters: ModelLetters): LaidOutDescription {
    const segments = segmentDescription(description);
    const { labels, sure } = labelSegments(segments);
    if (letters.length !== segments.length) return { blocks: buildDescriptionBlocks(segments, labels), changed: false };

    const guessed = segments.map((_, i) => i).filter((i) => !sure[i] && letters[i] !== ".");
    const headings = guessed.filter((i) => letters[i] === "H").length;
    if (guessed.length === 0 || headings > Math.max(2, guessed.length / 2)) {
        return { blocks: buildDescriptionBlocks(segments, labels), changed: false };
    }

    const merged: SegmentLabel[] = labels.slice();
    for (const i of guessed) {
        const letter = letters[i] as SegmentLabel;
        if (letter === "H" && !headingShaped(segments[i]!.text)) continue;
        merged[i] = letter;
    }
    return {
        blocks: buildDescriptionBlocks(segments, merged),
        changed: merged.some((label, i) => label !== labels[i]),
    };
}

/** Worth a model call: local AI is on and the rules guessed enough lines. */
export function descriptionWantsModel(description: string | null | undefined): boolean {
    if (!description?.trim() || !localAiTaskReady()) return false;
    const { sure } = labelSegments(segmentDescription(description));
    return sure.filter((s) => !s).length >= MIN_GUESSED_LINES;
}

/**
 * Ask the on-device model to label this description's lines. Resolves the
 * letters (cached for next time) or null when the model is off, busy past
 * its timeout, or answered nothing usable.
 */
export async function labelDescriptionOnDevice({
    description,
    priority = "visible",
    signal,
}: {
    description: string;
    priority?: LocalAiTaskPriority;
    signal?: AbortSignal;
}): Promise<ModelLetters | null> {
    const cached = readCachedDescriptionLayout(description);
    if (cached) return cached;
    if (!descriptionWantsModel(description)) return null;

    const segments = segmentDescription(description);
    const asked = Math.min(segments.length, MAX_PROMPT_LINES);
    const output = await runLocalAiTask({
        key: `jd-layout:${cacheKey(description)}`,
        prompt: buildDescriptionLayoutPrompt(segments),
        priority,
        signal,
        engines: DESCRIPTION_LAYOUT_ENGINES,
        temperature: 0,
        maxTokens: asked * 5 + 24,
        timeoutMs: 25_000,
    });
    if (!output) return null;
    const letters = parseDescriptionLayout(output, segments.length);
    // An answer that labelled under half the lines it was shown is a model
    // that didn't follow the format; don't remember it.
    if (letters.slice(0, asked).replace(/\./g, "").length < asked / 2) return null;
    writeCachedDescriptionLayout(description, letters);
    return letters;
}

/** Test helper — clears the in-memory cache (not localStorage). */
export function resetDescriptionLayoutCacheForTests(): void {
    memoryCache.clear();
}
