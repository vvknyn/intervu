/**
 * A "Save this search" that met the sign-in card, kept for this tab until the
 * sign-in comes back and then saved to the account (`savePendingSearchAfterSignIn`
 * in use-saved-searches.ts). Without it a guest who signed up to save a search
 * landed back on it with nothing saved.
 *
 * Written only when the guest takes one of the card's doors (`SignupGate`'s
 * `onEngage`), so a card closed with "Not now" leaves nothing behind, and
 * taken (read and cleared) by the first signed-in /jobs load, so it can never
 * be saved twice or after an unrelated later sign-in. Tab-scoped
 * (sessionStorage) and short-lived for the same reason as pending-actions.ts.
 */

export const PENDING_SAVED_SEARCH_KEY = "velai.auth.pendingSavedSearch";

/** A sign-in that takes longer than this is a different visit. */
export const PENDING_SAVED_SEARCH_MAX_AGE_MS = 60 * 60 * 1000;

export interface PendingSavedSearchStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface PendingSavedSearch {
    name: string;
    href: string;
}

export function stashPendingSavedSearch(
    storage: PendingSavedSearchStorage,
    entry: PendingSavedSearch,
    now = Date.now(),
): void {
    const name = entry.name.trim();
    const href = entry.href.trim();
    if (!name || !href) return;
    try {
        storage.setItem(PENDING_SAVED_SEARCH_KEY, JSON.stringify({ name, href, createdAt: now }));
    } catch {
        // Best-effort: a full or blocked storage means the person saves it again after signing in.
    }
}

/** The stashed search, if one is fresh; always clears it. */
export function takePendingSavedSearch(storage: PendingSavedSearchStorage, now = Date.now()): PendingSavedSearch | null {
    let raw: string | null;
    try {
        raw = storage.getItem(PENDING_SAVED_SEARCH_KEY);
        storage.removeItem(PENDING_SAVED_SEARCH_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const { name, href, createdAt } = parsed;
        if (typeof name !== "string" || typeof href !== "string" || typeof createdAt !== "number") return null;
        if (now - createdAt > PENDING_SAVED_SEARCH_MAX_AGE_MS || createdAt > now) return null;
        return name.trim() && href.trim() ? { name: name.trim(), href: href.trim() } : null;
    } catch {
        return null;
    }
}
