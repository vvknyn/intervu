"use client";

import { resolveApplyClickDecision } from "@/lib/jobs/pending-actions";

/** True when `url` is safe to hand off as a real navigation target. */
export function isHttpApplyUrl(url: string): boolean {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Shared Apply-click handler: every surface opens the employer apply URL
 * immediately — no auth wall before departure. Signed-in users keep
 * apply-intent / tracker behavior via `perform`; guests may receive an
 * optional post-open tracker prompt via `onGuestApplied`.
 *
 * Pass the employer URL as `window.open`'s first argument and do not put
 * `noopener` in the feature string. That feature creates `about:blank` and
 * assigns `location` afterwards; closing the tailor dialog in the same turn
 * severs the opener and the new tab stays on a blank spinner. The dialog's
 * Continue control is a real `<a target="_blank">` instead, so it does not
 * call this helper. Sever `opener` after the window exists.
 */
export function openApplyUrl(url: string): void {
    if (!isHttpApplyUrl(url) || typeof window === "undefined") return;
    const opened = window.open(url, "_blank");
    if (!opened) return;
    try {
        opened.opener = null;
    } catch {
        // Cross-origin opener policy already severed it.
    }
}

export function useGatedApply<Job>({
    user,
    perform,
    onGuestApplied,
}: {
    user: unknown;
    /** @deprecated Apply no longer auth-gates — kept for call-site compatibility. */
    gate?: (action: { kind: "apply"; payload: Job }) => void;
    /** @deprecated Apply no longer sets auth reason — use onGuestApplied. */
    setAuthGateReason?: (reason: unknown) => void;
    setAuthTrigger?: (trigger: unknown) => void;
    perform: (job: Job) => void;
    /** Fired after perform for signed-out users — optional tracker prompt. */
    onGuestApplied?: (job: Job) => void;
}): (job: Job) => void {
    return (job: Job) => {
        if (resolveApplyClickDecision(Boolean(user)) === "perform") {
            perform(job);
            if (!user) onGuestApplied?.(job);
        }
    };
}
