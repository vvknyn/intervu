/**
 * Consent gate for on-device AI — no model download until the user clicks Enable.
 */

export const LOCAL_AI_CONSENT_KEY = "velai.localAi.consent";

function getStorage(): Storage | null {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
}

export function readLocalAiConsent(): boolean {
    const storage = getStorage();
    if (!storage) return false;
    try {
        return storage.getItem(LOCAL_AI_CONSENT_KEY) === "1";
    } catch {
        return false;
    }
}

export function grantLocalAiConsent(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(LOCAL_AI_CONSENT_KEY, "1");
    } catch {
        // Best-effort — user can re-consent next visit.
    }
}

export function revokeLocalAiConsent(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.removeItem(LOCAL_AI_CONSENT_KEY);
    } catch {
        // ignore
    }
}
