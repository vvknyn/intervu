/**
 * Dismissal state for the top-of-board launch banner (`LaunchBanner.tsx`)
 * that points visitors at `/connect` — the "search jobs from inside your AI
 * assistant" entry point. Same defensive localStorage idiom as
 * `visit-cursor.ts` (try/catch around access for private-mode/SSR/quota
 * failures) but a single permanent flag rather than a cursor: this banner is
 * a one-time announcement, not a recurring "what's new" diff, so once
 * dismissed it stays dismissed — no day-scoped re-show like
 * `MotivationalBanner`'s DISMISSED_UNTIL_KEY.
 *
 * Any stored value other than the exact "true" sentinel — missing, garbled,
 * or written by some future/older schema — reads as "not dismissed", so a
 * corrupted flag fails open to SHOWING the banner rather than hiding it (or
 * throwing).
 */

const LAUNCH_BANNER_DISMISSED_KEY = "intervu.launchBanner.dismissed";

export function readLaunchBannerDismissed(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return localStorage.getItem(LAUNCH_BANNER_DISMISSED_KEY) === "true";
    } catch {
        return false;
    }
}

export function writeLaunchBannerDismissed(): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(LAUNCH_BANNER_DISMISSED_KEY, "true");
    } catch {
        /* quota exceeded / private mode */
    }
}
