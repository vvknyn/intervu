"use server";

import { getServerUser } from "@/lib/auth/session";
import { getSuppressionEntries, isSuppressedForKind, suppress, unsuppress } from "@/lib/email/suppression";
import { isReachableEmail } from "@/lib/auth/username-email";

export interface EmailPreferences {
    digestEnabled: boolean;
    /** True when an "all" suppression (global unsubscribe, or a bounce/
     *  complaint) is blocking every kind — surfaced so the UI can explain
     *  WHY the toggle won't stick rather than silently reverting it. */
    blockedGlobally: boolean;
    /** True when the account has no address mail can actually reach, so the
     *  UI offers "add an email" instead of a delivery switch that decides
     *  nothing. See `isReachableEmail`. */
    needsEmail: boolean;
}

export async function getEmailPreferencesAction(): Promise<{ data?: EmailPreferences; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Sign in to manage email preferences." };

    // Not `!user.email`. A legacy password signup carries a minted
    // <username>@intervu.cc address — non-empty, so that guard passed, and
    // this page reported the weekly digest as ON while send.ts was dropping
    // every one of those sends as `no-mailbox` a layer down.
    const reachable = isReachableEmail(user.email);
    const entries = reachable ? await getSuppressionEntries(user.email!) : {};

    return {
        data: {
            // Reachability is part of the answer, not a separate flag the UI
            // has to remember to check. An unreachable account's digest is
            // OFF in the only sense that matters — nothing arrives — so
            // saying otherwise would restate the bug in a new field.
            digestEnabled: reachable && !isSuppressedForKind(entries, "digest"),
            blockedGlobally: Boolean(entries.all),
            needsEmail: !reachable,
        },
    };
}

/**
 * The single write path for the digest toggle — same suppression store the
 * unsubscribe link writes to (suppression.ts), so a link-based unsubscribe
 * and this toggle can never disagree about a user's current state.
 *
 * Turning it back ON only clears the "digest"-scoped entry, never an "all"
 * entry: an "all" suppression can mean a deliberate global unsubscribe OR a
 * bounce/complaint (send.ts's webhook receiver writes those the same way),
 * and a preference toggle must not be able to silently revive an address
 * Resend told us is bad — the whole point of honoring bounces.
 */
export async function setDigestPreferenceAction(enabled: boolean): Promise<{ success: true } | { error: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Sign in to manage email preferences." };

    // Refuse rather than record a preference that decides nothing. Writing
    // "digest on" against an unreachable address would leave the suppression
    // store claiming a delivery state send.ts can never honor.
    const email = user.email;
    if (!isReachableEmail(email)) {
        return { error: "Add an email address before turning on job alerts." };
    }

    if (enabled) {
        await unsuppress(email!, "digest");
    } else {
        await suppress(email!, "digest", "unsubscribed");
    }
    return { success: true };
}
