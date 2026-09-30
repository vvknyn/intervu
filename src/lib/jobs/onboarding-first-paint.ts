/**
 * localStorage flag for the signed-in résumé onboarding card. /jobs no longer
 * mounts that card (2026-09-29: an account without a résumé gets the board
 * and its résumé band instead), so nothing in the app reads this now; journey
 * specs still seed it for returning visitors, which stays harmless. Nothing
 * here gates the search box or job rows, and no first-paint script or
 * document class hides the site chrome.
 */
export const ONBOARDING_COMPLETED_STORAGE_KEY = "velai.onboarding.completed";

export function readOnboardingCompletedFromStorage(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export function writeOnboardingCompletedInStorage(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "1");
        window.dispatchEvent(new Event("velai-onboarding-storage"));
    } catch {
        /* private mode */
    }
}

export function subscribeOnboardingCompleted(onStoreChange: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("storage", onStoreChange);
    window.addEventListener("velai-onboarding-storage", onStoreChange);
    return () => {
        window.removeEventListener("storage", onStoreChange);
        window.removeEventListener("velai-onboarding-storage", onStoreChange);
    };
}
