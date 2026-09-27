/**
 * One-shot session latch: after onboarding or résumé import, auto-open the
 * "all matches" deck once fit data is ready (CRAFT-3).
 */
export const FIRST_PACK_REVEAL_KEY = "velai.firstPackReveal";

function getStorage(): Storage | null {
    if (typeof globalThis.sessionStorage === "undefined") return null;
    return globalThis.sessionStorage;
}

export function armFirstPackReveal(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(FIRST_PACK_REVEAL_KEY, "1");
    } catch {
        /* private mode */
    }
}

/** Read and clear — returns true only once per armed session. */
export function consumeFirstPackReveal(): boolean {
    const storage = getStorage();
    if (!storage) return false;
    try {
        if (storage.getItem(FIRST_PACK_REVEAL_KEY) !== "1") return false;
        storage.removeItem(FIRST_PACK_REVEAL_KEY);
        return true;
    } catch {
        return false;
    }
}

export function clearFirstPackReveal(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.removeItem(FIRST_PACK_REVEAL_KEY);
    } catch {
        /* ignored */
    }
}
