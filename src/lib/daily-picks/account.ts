/**
 * The daily picks setting for one account, as everything that shows or
 * changes it reads it: Settings and Today (actions/daily-picks.ts) and a
 * connected AI (the MCP `daily_picks` tool). "On" means the person turned it
 * on and hasn't unsubscribed since, from its own link or from every Velai
 * email, because that is when an email can actually go out.
 *
 * Plain module, server code only.
 */
import { hasPaidAccess, paymentRequired } from "@/lib/billing/access";
import { isReachableEmail } from "@/lib/auth/username-email";
import { getSuppressionEntries, isSuppressedForKind, unsuppress } from "@/lib/email/suppression";
import { getDailyPicksState, setDailyPicksOn, type DailyPicksState } from "./state";

export interface DailyPicksSetting {
    state: DailyPicksState;
    /** Turned on, mail reaches the account, and it isn't unsubscribed. */
    on: boolean;
    reachable: boolean;
    /** Unsubscribed from every Velai email (or bounced), which a switch can't undo. */
    blockedGlobally: boolean;
}

export const NO_ADDRESS_ERROR = "Add an email address before turning on daily picks.";

export async function readDailyPicksSetting(uid: string, email: string | null | undefined): Promise<DailyPicksSetting> {
    const reachable = isReachableEmail(email);
    const [state, entries] = await Promise.all([
        getDailyPicksState(uid),
        reachable ? getSuppressionEntries(email!) : Promise.resolve({}),
    ]);
    return {
        state,
        on: reachable && state.on && !isSuppressedForKind(entries, "daily_picks"),
        reachable,
        blockedGlobally: Boolean("all" in entries && entries.all),
    };
}

/**
 * Turns it on or off. On clears only its own unsubscribe (a click on an
 * earlier email's link), never an "all" one: that can be a bounce or a spam
 * complaint, which a switch must not undo (the digest's rule too,
 * actions/email-preferences.ts).
 */
export async function writeDailyPicksSetting(
    uid: string,
    email: string | null | undefined,
    on: boolean,
    isPaid: (uid: string) => Promise<boolean> = hasPaidAccess,
): Promise<{ ok: true } | { error: string; code?: ReturnType<typeof paymentRequired>["code"] }> {
    if (on) {
        if (!isReachableEmail(email)) return { error: NO_ADDRESS_ERROR };
        // Turning it off is never refused: it stops the email.
        if (!(await isPaid(uid))) return paymentRequired();
        await unsuppress(email!, "daily_picks");
    }
    await setDailyPicksOn(uid, on);
    return { ok: true };
}
