/**
 * Auth popover value lines — one helper keyed by reason class (apply | read |
 * generic), not by button name. When the guest pursuit store has a real count,
 * prepends an honest keep-line; never fabricates a count.
 */

export type AuthGateReason = "apply" | "read" | "generic";

export const GUEST_SAVE_TOAST = "Saved — find it in your Tracker";

const AUTH_GATE_LEAD: Record<AuthGateReason, string> = {
    apply: "Create a free account — we'll take you straight to the posting and start tracking this application.",
    read: "Sign in to read the full posting.",
    generic: "Sign in to sync your tracker across devices.",
};

/** Honest keep-line when guest pursuits exist; null when count is zero. */
export function guestKeepLine(guestPursuitCount: number): string | null {
    if (guestPursuitCount <= 0) return null;
    return guestPursuitCount === 1
        ? "We'll keep the role you've saved on this device."
        : `We'll keep the ${guestPursuitCount} roles you've saved on this device.`;
}

/** Value line for AuthPopover — reason class + optional honest guest count. */
export function formatAuthGateValueLine(reason: AuthGateReason, guestPursuitCount = 0): string {
    const keep = guestKeepLine(guestPursuitCount);
    const lead = AUTH_GATE_LEAD[reason];
    return keep ? `${keep} ${lead}` : lead;
}

/** Tracker empty-state suffix after the "Sign in" link. */
export function guestTrackerSyncSuffix(guestPursuitCount: number): string {
    const keep = guestKeepLine(guestPursuitCount);
    if (keep) return `${keep} Sign in to sync across devices.`;
    return "to sync your tracked roles across devices.";
}

/** Exported guest-surface strings for jargon guard tests. */
export const GUEST_AUTH_STRINGS: Record<string, string> = {
    SAVE_TOAST: GUEST_SAVE_TOAST,
    KEEP_ONE: guestKeepLine(1)!,
    KEEP_TWO: guestKeepLine(2)!,
    APPLY_LINE: formatAuthGateValueLine("apply", 0),
    READ_LINE: formatAuthGateValueLine("read", 0),
    GENERIC_LINE: formatAuthGateValueLine("generic", 0),
    APPLY_WITH_KEEP: formatAuthGateValueLine("apply", 2),
    SYNC_EMPTY: guestTrackerSyncSuffix(0),
    SYNC_WITH_KEEP: guestTrackerSyncSuffix(1),
};
