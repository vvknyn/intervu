"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getSuppressionEntries, isSuppressedForKind, suppress, unsuppress } from "@/lib/email/suppression";

export interface EmailPreferences {
    digestEnabled: boolean;
    /** True when an "all" suppression (global unsubscribe, or a bounce/
     *  complaint) is blocking every kind — surfaced so the UI can explain
     *  WHY the toggle won't stick rather than silently reverting it. */
    blockedGlobally: boolean;
}

export async function getEmailPreferencesAction(): Promise<{ data?: EmailPreferences; error?: string }> {
    const user = await getServerUser();
    if (!user?.email) return { error: "Sign in to manage email preferences." };

    const entries = await getSuppressionEntries(user.email);
    return {
        data: {
            digestEnabled: !isSuppressedForKind(entries, "digest"),
            blockedGlobally: Boolean(entries.all),
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
    if (!user?.email) return { error: "Sign in to manage email preferences." };

    if (enabled) {
        await unsuppress(user.email, "digest");
    } else {
        await suppress(user.email, "digest", "unsubscribed");
    }
    return { success: true };
}
