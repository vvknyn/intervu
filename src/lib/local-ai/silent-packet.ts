/**
 * Silent packet — background on-device résumé pre-warm for high-fit jobs.
 * Pure logic only (no React, no localStorage).
 */

import { MATCH_CHIP_BRAND_THRESHOLD } from "@/lib/match/score";
import type { TailorDraft } from "./tailor-resume";
import type { ResumeData } from "@/types/resume";

/** Reuses the match-chip brand threshold — pre-warm only when fit is strong. */
export const SILENT_PACKET_FIT_THRESHOLD = MATCH_CHIP_BRAND_THRESHOLD;

export const SILENT_PACKET_PREWARM_DEBOUNCE_MS = 1200;

export interface ShouldPrewarmSilentPacketArgs {
    localAiEnabled: boolean;
    resumeUsable: boolean;
    /** `scoreJobAgainstResume(...).total`, or null when no honest match exists. */
    fitTotal: number | null;
}

/**
 * Gate for background pre-warm. Requires local AI, a usable résumé, and fit
 * at/above {@link SILENT_PACKET_FIT_THRESHOLD}. A job surfaced via `sort=fit`
 * does NOT bypass a low score — fit must still meet the threshold so weak
 * ranked hits never burn the on-device model.
 */
export function shouldPrewarmSilentPacket(args: ShouldPrewarmSilentPacketArgs): boolean {
    if (!args.localAiEnabled || !args.resumeUsable) return false;
    if (args.fitTotal == null) return false;
    return args.fitTotal >= SILENT_PACKET_FIT_THRESHOLD;
}

/** Stable digest of résumé identity fields used for tailoring. */
export function resumeFingerprint(resume: ResumeData): string {
    const profile = {
        name: resume.profile?.name ?? "",
        profession: resume.profile?.profession ?? "",
        yearsOfExperience: resume.profile?.yearsOfExperience ?? 0,
        location: resume.profile?.location ?? "",
    };
    const experience = (resume.experience ?? []).map((exp) => ({
        id: exp.id,
        company: exp.company,
        role: exp.role,
        description: exp.description ?? "",
    }));
    const summary = resume.generatedSummary ?? "";
    return hashStableJson({ profile, experience, summary });
}

export function silentPacketCacheKey(jobId: string, resumeFingerprint: string): string {
    return `${jobId}:${resumeFingerprint}`;
}

function normalizeWhitespace(text: string): string {
    return text.trim().replace(/\s+/g, " ");
}

/** True when summary or any bullet differs after simple whitespace normalization. */
export function hasMeaningfulDiff(draft: TailorDraft | null | undefined): boolean {
    if (!draft) return false;
    const summaryBefore = normalizeWhitespace(draft.summaryBefore ?? "");
    const summaryAfter = normalizeWhitespace(draft.summaryAfter ?? "");
    if (summaryBefore !== summaryAfter) return true;
    return draft.bullets.some(
        (b) => normalizeWhitespace(b.before ?? "") !== normalizeWhitespace(b.after ?? ""),
    );
}

/** A cached draft is "ready" when it has tailored content with a meaningful diff. */
export function isSilentPacketDraftReady(draft: TailorDraft | null | undefined): boolean {
    if (!draft?.summaryAfter?.trim()) return false;
    return hasMeaningfulDiff(draft);
}

export interface ShouldShowReviewPacketArgs {
    status: "idle" | "warming" | "ready";
    draft: TailorDraft | null;
}

/** Show Review packet / Packet when warming or ready with a meaningful diff. */
export function shouldShowReviewPacket(args: ShouldShowReviewPacketArgs): boolean {
    if (args.status === "warming") return true;
    if (args.status === "ready" && hasMeaningfulDiff(args.draft)) return true;
    return false;
}

export interface ShouldSilentPrewarmRunArgs extends ShouldPrewarmSilentPacketArgs {
    consent: boolean;
}

/** Background pre-warm runs only with consent — no silent rules-only packets. */
export function shouldSilentPrewarmRun(args: ShouldSilentPrewarmRunArgs): boolean {
    if (!args.consent) return false;
    return shouldPrewarmSilentPacket(args);
}

function hashStableJson(value: unknown): string {
    const json = stableStringify(value);
    let hash = 5381;
    for (let i = 0; i < json.length; i++) {
        hash = (hash * 33) ^ json.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

export interface SilentPacketPrewarmScheduler {
    schedule(fn: () => void, delayMs: number): unknown;
    cancel(handle: unknown): void;
}

const realScheduler: SilentPacketPrewarmScheduler = {
    schedule: (fn, delayMs) => setTimeout(fn, delayMs),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SilentPacketPrewarm {
    schedule(): void;
    /** Cancel debounce and invalidate any in-flight run tied to this instance. */
    cancel(): void;
    /** Generation captured when a debounced fire runs — pass to `shouldApplyRun`. */
    captureRunGeneration(): number;
    shouldApplyRun(runGeneration: number): boolean;
}

export function createSilentPacketPrewarm(
    onFire: () => void,
    debounceMs: number = SILENT_PACKET_PREWARM_DEBOUNCE_MS,
    scheduler: SilentPacketPrewarmScheduler = realScheduler,
): SilentPacketPrewarm {
    let timer: unknown = null;
    let generation = 0;
    let runGeneration = 0;

    const cancelTimer = () => {
        if (timer !== null) {
            scheduler.cancel(timer);
            timer = null;
        }
    };

    return {
        schedule() {
            cancelTimer();
            const scheduledGeneration = ++generation;
            timer = scheduler.schedule(() => {
                timer = null;
                if (scheduledGeneration !== generation) return;
                runGeneration = scheduledGeneration;
                onFire();
            }, debounceMs);
        },
        cancel() {
            generation++;
            runGeneration = 0;
            cancelTimer();
        },
        captureRunGeneration() {
            return runGeneration;
        },
        shouldApplyRun(gen: number) {
            return gen !== 0 && gen === runGeneration && gen === generation;
        },
    };
}

/** Module-level dedupe so multiple panels never run the model twice for one key. */
const prewarmInflight = new Map<string, Promise<TailorDraft>>();

export function getOrRunSilentPacketPrewarm(
    cacheKey: string,
    run: () => Promise<TailorDraft>,
): Promise<TailorDraft> {
    const existing = prewarmInflight.get(cacheKey);
    if (existing) return existing;
    const promise = run().finally(() => {
        prewarmInflight.delete(cacheKey);
    });
    prewarmInflight.set(cacheKey, promise);
    return promise;
}

/** Test-only: clear in-flight dedupe map. */
export function resetSilentPacketPrewarmInflightForTests(): void {
    prewarmInflight.clear();
}
