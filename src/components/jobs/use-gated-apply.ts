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
 * Shared Apply-click handler: signed-in users open the employer apply URL
 * immediately. Signed-out visitors hit the auth gate first — no direct
 * departure to the employer site.
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
    gate,
    perform,
}: {
    user: unknown;
    gate?: (action: { kind: "apply"; payload: Job }) => void;
    /** @deprecated Apply no longer sets auth reason here — use gate meta. */
    setAuthGateReason?: (reason: unknown) => void;
    setAuthTrigger?: (trigger: unknown) => void;
    perform: (job: Job) => void;
    /** @deprecated Signed-out Apply is auth-gated before departure. */
    onGuestApplied?: (job: Job) => void;
}): (job: Job) => void {
    return (job: Job) => {
        if (resolveApplyClickDecision(Boolean(user)) === "gate") {
            gate?.({ kind: "apply", payload: job });
            return;
        }
        perform(job);
    };
}
