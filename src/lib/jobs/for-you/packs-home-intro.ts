/**
 * Once-per-user dismissal for the packs-home intro modal.
 * Same guarded localStorage shape as first-run-hint / last-home-view.
 */
export const PACKS_HOME_INTRO_KEY = "velai-packs-home-intro-v1";

function getStorage(): Storage | null {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
}

export function readPacksHomeIntroDismissed(): boolean {
    const storage = getStorage();
    if (!storage) return false;
    try {
        return storage.getItem(PACKS_HOME_INTRO_KEY) === "1";
    } catch {
        return false;
    }
}

export function writePacksHomeIntroDismissed(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(PACKS_HOME_INTRO_KEY, "1");
    } catch {
        // Private browsing / quota — modal may reappear next visit.
    }
}
