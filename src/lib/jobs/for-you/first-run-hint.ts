/**
 * Persists dismissal of the For-you deck's first-run inline help box.
 * Same shape as `last-home-view.ts`: a guarded `localStorage` accessor so
 * this reads/writes correctly (or no-ops) in private browsing / SSR / a
 * quota error, and never throws.
 */
export const FOR_YOU_HINT_DISMISSED_KEY = "intervu.jobs.forYouHintDismissed";

function getStorage(): Storage | null {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
}

export function readForYouHintDismissed(): boolean {
    const storage = getStorage();
    if (!storage) return false;
    try {
        return storage.getItem(FOR_YOU_HINT_DISMISSED_KEY) === "1";
    } catch {
        return false;
    }
}

export function writeForYouHintDismissed(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(FOR_YOU_HINT_DISMISSED_KEY, "1");
    } catch {
        // Private browsing / quota — the hint just reappears next visit.
    }
}
