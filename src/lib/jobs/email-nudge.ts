/**
 * When to ask a SIGNED-IN visitor for an address we can actually reach.
 *
 * The mirror image of `onboarding-prompt.ts`: that one catches people with no
 * account, this one catches people who have one that mail cannot reach — a
 * legacy password signup registered under a minted `<username>@intervu.cc`
 * (see `username-email.ts`). Both are pure so the policy is testable without
 * a browser or a session.
 *
 * Same "earn the ask" shape, for the same reason. Alerts are only worth
 * anything to someone who has shown they're looking, so the banner waits for
 * a search rather than greeting an account on arrival.
 */
import { readBrowserFlag, setBrowserFlag } from "./browser-storage";

/** Searches before we ask. Lower than the signed-out wizard's threshold: this
 *  is one line and a text box, not a multi-step form, and the person has
 *  already committed enough to make an account. */
export const NUDGE_AFTER_INTERACTIONS = 2;

export const EMAIL_NUDGE_DISMISSED_KEY = "intervu.jobs.emailNudge.dismissed";

export interface EmailNudgeInput {
    /** Firebase has resolved someone. */
    signedIn: boolean;
    /** The account has no address mail can reach (`isReachableEmail` is false). */
    needsEmail: boolean;
    /** They closed it once. */
    dismissed: boolean;
    /** Searches run in this browser. */
    interactions: number;
}

/**
 * Note the ORDER: signed-out and already-reachable are checked before the
 * interaction count, so the common case costs nothing and the count can never
 * pull a banner onto a page that shouldn't show one.
 */
export function shouldPromptEmailNudge(input: EmailNudgeInput): boolean {
    if (!input.signedIn) return false;
    if (!input.needsEmail) return false;
    if (input.dismissed) return false;
    return input.interactions >= NUDGE_AFTER_INTERACTIONS;
}

export function isEmailNudgeDismissed(): boolean {
    return readBrowserFlag(EMAIL_NUDGE_DISMISSED_KEY);
}

export function dismissEmailNudge(): void {
    setBrowserFlag(EMAIL_NUDGE_DISMISSED_KEY);
}
