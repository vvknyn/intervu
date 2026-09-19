/**
 * On-device AI inference opt-in — NOT a résumé-parse mode switch. Résumé
 * import always parses on-device now (founder rule: résumé interpretation
 * never happens on our servers); this flag instead gates other on-device
 * features that DO still have a choice: job-tailoring/customization
 * (LocalCustomizePanel) and guest résumé caching on /jobs and public job
 * pages. Default OFF. Enable via the Settings toggle (LocalAiSettingsSection)
 * or `?localAi=1` on any page (persists to localStorage for the session and
 * future visits).
 */

export const LOCAL_AI_ENABLED_KEY = "velai.localAi.enabled";

function getStorage(): Storage | null {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
}

/** Safe outside the browser (unit tests stub `globalThis.localStorage`). */
export function isBrowser(): boolean {
    return getStorage() !== null;
}

export function readLocalAiEnabled(): boolean {
    const storage = getStorage();
    if (!storage) return false;
    try {
        return storage.getItem(LOCAL_AI_ENABLED_KEY) === "1";
    } catch {
        return false;
    }
}

export function writeLocalAiEnabled(enabled: boolean): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        if (enabled) {
            storage.setItem(LOCAL_AI_ENABLED_KEY, "1");
        } else {
            storage.removeItem(LOCAL_AI_ENABLED_KEY);
        }
    } catch {
        // Private browsing / quota — ignore; flag stays session-only via URL.
    }
}

/**
 * When `?localAi=1` is present, turn the flag ON and persist it.
 * Returns whether local mode is active after applying the param.
 */
export function applyLocalAiSearchParam(param: string | null | undefined): boolean {
    if (param === "1") {
        writeLocalAiEnabled(true);
        return true;
    }
    return readLocalAiEnabled();
}
