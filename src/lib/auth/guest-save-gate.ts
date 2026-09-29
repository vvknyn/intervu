/**
 * Guest save gate — tracks how many times an anonymous visitor has saved
 * (either a "Go after" pursuit or a saved search) and whether they've
 * dismissed the post-first-save upsell banner.
 *
 * Counter is intentionally shared across both save paths: the gating rule
 * is "2nd guest save in any category → require sign-in", not "2nd of the
 * same kind", so one localStorage key covers both. Same defensive idiom as
 * `launch-banner.ts` (try/catch, `typeof window` guard).
 */

const SAVE_COUNT_KEY = "intervu.guestSaveCount";
const SAVE_BANNER_DISMISSED_KEY = "intervu.guestSaveBanner.dismissed";

function storage(): Storage | null {
    try {
        return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
        return null;
    }
}

export function getGuestSaveCount(): number {
    const raw = storage()?.getItem(SAVE_COUNT_KEY);
    const n = parseInt(raw ?? "0", 10);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
}

/** The one rule: a guest's first save is free, every later one needs an account. */
export function guestSaveGateReached(): boolean {
    return getGuestSaveCount() >= 1;
}

/** Increment the guest save counter and return the new count. */
export function recordGuestSave(): number {
    const next = getGuestSaveCount() + 1;
    try {
        storage()?.setItem(SAVE_COUNT_KEY, String(next));
    } catch {
        /* quota exceeded / private mode */
    }
    return next;
}

export function isGuestSaveBannerDismissed(): boolean {
    return storage()?.getItem(SAVE_BANNER_DISMISSED_KEY) === "true";
}

export function dismissGuestSaveBanner(): void {
    try {
        storage()?.setItem(SAVE_BANNER_DISMISSED_KEY, "true");
    } catch {
        /* quota exceeded / private mode */
    }
}
