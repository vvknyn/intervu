/**
 * The deck's "more / fewer like this" nudges (tuning.ts), kept in this
 * browser only. Same layers as recently-viewed.ts: localStorage wrappers that
 * degrade to "no nudges" on any failure, and a module store for
 * `useSyncExternalStore`. A nudge holds the role's title words, skills and
 * company, never the résumé.
 */
import { useSyncExternalStore } from "react";
import { readBrowserValue, writeBrowserValue } from "@/lib/jobs/browser-storage";
import type { PublicJob } from "@/lib/jobs/types";
import {
    addNudge,
    MAX_NUDGES,
    NUDGE_MAX_AGE_MS,
    removeNudge,
    roleFeatures,
    SIGNAL_WEIGHT,
    type TuningNudge,
    type TuningSignal,
} from "@/lib/jobs/for-you/tuning";

export const DECK_TUNING_KEY = "velai.deck-tuning.v1";

function isNudge(value: unknown): value is TuningNudge {
    if (typeof value !== "object" || value == null) return false;
    const v = value as Record<string, unknown>;
    const f = v.features as Record<string, unknown> | undefined;
    return (
        typeof v.jobId === "string" &&
        typeof v.signal === "string" &&
        v.signal in SIGNAL_WEIGHT &&
        typeof v.at === "number" &&
        typeof f === "object" &&
        f != null &&
        typeof f.role === "string" &&
        Array.isArray(f.words) &&
        Array.isArray(f.families) &&
        Array.isArray(f.skills)
    );
}

export function loadNudges(nowMs = Date.now()): TuningNudge[] {
    try {
        const raw = readBrowserValue(DECK_TUNING_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(isNudge)
            .filter((nudge) => nowMs - nudge.at < NUDGE_MAX_AGE_MS)
            .slice(0, MAX_NUDGES);
    } catch {
        return [];
    }
}

const NO_NUDGES: TuningNudge[] = [];
let cache: TuningNudge[] | null = null;
const listeners = new Set<() => void>();

function commit(next: TuningNudge[]): TuningNudge[] {
    cache = next;
    writeBrowserValue(DECK_TUNING_KEY, JSON.stringify(next));
    listeners.forEach((listener) => listener());
    return next;
}

export function subscribeNudges(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
}

export function getNudgesSnapshot(): TuningNudge[] {
    if (cache == null) cache = loadNudges();
    return cache;
}

function getServerNudges(): TuningNudge[] {
    return NO_NUDGES;
}

/** Record a signal on a role; returns the nudges as they now stand. */
export function recordNudge(job: PublicJob, signal: TuningSignal, nowMs = Date.now()): TuningNudge[] {
    const current = getNudgesSnapshot();
    const next = addNudge(current, { jobId: job.id, signal, at: nowMs, features: roleFeatures(job) }, nowMs);
    if (next.length === current.length && next.every((nudge, index) => nudge === current[index])) return current;
    return commit(next);
}

/** Take back the nudge a role was given (tapping "more like this" again). */
export function clearNudge(jobId: string): TuningNudge[] {
    const current = getNudgesSnapshot();
    if (!current.some((nudge) => nudge.jobId === jobId)) return current;
    return commit(removeNudge(current, jobId));
}

export function resetNudges(): TuningNudge[] {
    return getNudgesSnapshot().length === 0 ? getNudgesSnapshot() : commit([]);
}

export function useDeckNudges(): TuningNudge[] {
    return useSyncExternalStore(subscribeNudges, getNudgesSnapshot, getServerNudges);
}
