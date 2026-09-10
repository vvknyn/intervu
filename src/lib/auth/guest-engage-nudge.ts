/**
 * Guest engage nudge — after first meaningful browse engagement, offer a
 * dismissible sign-in upsell (same visual idiom as `guest-save-gate.ts`).
 *
 * Counters live in localStorage (not React-only) so SERP `result_clicked`
 * and JobDetail `job_viewed` both contribute regardless of which surface
 * mounted the recorder. Same defensive idiom as `guest-save-gate.ts`
 * (try/catch, `typeof window` guard).
 */

const RESULT_CLICKS_KEY = "intervu.guestEngage.resultClicks";
const JOB_VIEWS_KEY = "intervu.guestEngage.jobViews";
const NUDGE_DISMISSED_KEY = "intervu.guestEngage.nudge.dismissed";

const listeners = new Set<() => void>();

function storage(): Storage | null {
    try {
        return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
        return null;
    }
}

function notify(): void {
    listeners.forEach((cb) => cb());
}

export function subscribeGuestEngageNudge(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function readCount(key: string): number {
    const raw = storage()?.getItem(key);
    const n = parseInt(raw ?? "0", 10);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
}

function writeCount(key: string, value: number): void {
    try {
        storage()?.setItem(key, String(value));
    } catch {
        /* quota exceeded / private mode */
    }
}

export function getGuestResultClickCount(): number {
    return readCount(RESULT_CLICKS_KEY);
}

export function getGuestJobViewCount(): number {
    return readCount(JOB_VIEWS_KEY);
}

/** Increment the guest result-click counter and return the new count. */
export function recordGuestResultClick(): number {
    const next = getGuestResultClickCount() + 1;
    writeCount(RESULT_CLICKS_KEY, next);
    notify();
    return next;
}

/** Increment the guest job-view counter and return the new count. */
export function recordGuestJobView(): number {
    const next = getGuestJobViewCount() + 1;
    writeCount(JOB_VIEWS_KEY, next);
    notify();
    return next;
}

export function isGuestEngageNudgeDismissed(): boolean {
    return storage()?.getItem(NUDGE_DISMISSED_KEY) === "true";
}

export function dismissGuestEngageNudge(): void {
    try {
        storage()?.setItem(NUDGE_DISMISSED_KEY, "true");
    } catch {
        /* quota exceeded / private mode */
    }
    notify();
}

export interface GuestEngageNudgeInput {
    signedIn: boolean;
    dismissed: boolean;
    showingSaveBanner: boolean;
    resultClicks: number;
    jobViews: number;
}

/** Pure decision — unit-tested without DOM. */
export function shouldShowGuestEngageNudge({
    signedIn,
    dismissed,
    showingSaveBanner,
    resultClicks,
    jobViews,
}: GuestEngageNudgeInput): boolean {
    if (signedIn) return false;
    if (dismissed) return false;
    if (showingSaveBanner) return false;
    return resultClicks >= 1 || jobViews >= 2;
}
