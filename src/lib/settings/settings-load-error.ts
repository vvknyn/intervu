/**
 * Dedupes concurrent settings MCP/agent load failure notices. Fixture and
 * degraded environments often fail both credential and preference fetches
 * together; without a shared gate, duplicate toasts stack on the same tab.
 */

const DEDUP_WINDOW_MS = 4_000;

let lastNoticeKey: string | null = null;
let lastNoticeAt = 0;

/** @returns true when this scope may surface a load-failure notice (toast or alert). */
export function shouldEmitSettingsLoadError(scope: string): boolean {
    const now = Date.now();
    if (lastNoticeKey === scope && now - lastNoticeAt < DEDUP_WINDOW_MS) {
        return false;
    }
    lastNoticeKey = scope;
    lastNoticeAt = now;
    return true;
}

/** Clears dedup state — call when the user retries a load or leaves settings. */
export function resetSettingsLoadErrorDedup(): void {
    lastNoticeKey = null;
    lastNoticeAt = 0;
}

export const SETTINGS_AGENT_ACCESS_LOAD_ERROR =
    "Couldn't load your connected agents. Try refreshing the page.";

export const SETTINGS_AGENT_PREFERENCES_LOAD_ERROR = "Couldn't load your agent's answers.";

/** Toast chokepoint for load failures — inline surfaces prefer no toast at all. */
export function notifySettingsLoadErrorToast(
    scope: string,
    message: string,
    show: (message: string) => void,
): void {
    if (!shouldEmitSettingsLoadError(scope)) return;
    show(message);
}
