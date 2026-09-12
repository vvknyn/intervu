/**
 * Browser-only résumé cache for R&D local-AI mode (`velai.localAi.enabled`).
 * Signed-out guests keep parsed `ResumeData` here so Rank by fit survives refresh.
 */

import type { ResumeData } from "@/types/resume";

export const LOCAL_AI_RESUME_KEY = "velai.localAi.resume";

interface StoredLocalAiResume {
    data: ResumeData;
    updatedAt: string;
    sourceLabel?: string;
}

function getStorage(): Storage | null {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
}

export function readLocalAiResume(): {
    data: ResumeData;
    updatedAt: string;
    sourceLabel?: string;
} | null {
    const storage = getStorage();
    if (!storage) return null;
    try {
        const raw = storage.getItem(LOCAL_AI_RESUME_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredLocalAiResume;
        if (!parsed?.data || typeof parsed.updatedAt !== "string") return null;
        return {
            data: parsed.data,
            updatedAt: parsed.updatedAt,
            sourceLabel: typeof parsed.sourceLabel === "string" ? parsed.sourceLabel : undefined,
        };
    } catch {
        return null;
    }
}

export function writeLocalAiResume(
    data: ResumeData,
    updatedAt: string = new Date().toISOString(),
    sourceLabel?: string,
): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        const existing = readLocalAiResume();
        const label =
            sourceLabel !== undefined
                ? sourceLabel
                : existing?.sourceLabel;
        const payload: StoredLocalAiResume = {
            data,
            updatedAt,
            ...(label !== undefined ? { sourceLabel: label } : {}),
        };
        storage.setItem(LOCAL_AI_RESUME_KEY, JSON.stringify(payload));
    } catch {
        // Private browsing / quota — in-memory state still works this session.
    }
}

export function clearLocalAiResume(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.removeItem(LOCAL_AI_RESUME_KEY);
    } catch {
        // Best-effort.
    }
}
