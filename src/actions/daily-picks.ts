"use server";

/**
 * The signed-in person's daily picks email: whether it's on, and the last
 * email's roles for Today to pin (lib/daily-picks). One write path for the
 * switch in Settings and the one on Today, so the two never disagree.
 */
import { getServerUser } from "@/lib/auth/server-user";
import { readDailyPicksSetting, writeDailyPicksSetting } from "@/lib/daily-picks/account";
import { emailedToPin } from "@/lib/daily-picks/pick";
import { getBaseResumeForUser } from "@/lib/resume/base-resume";
import { resumeIsUsable } from "@/lib/resume/resume-usable";

export interface DailyPicksView {
    /** Turned on and not unsubscribed: an email can go out. */
    on: boolean;
    /** The account has an address mail reaches; without one the switch can't be turned on. */
    reachable: boolean;
    /** Unsubscribed from every Velai email, which the switch can't undo. */
    blockedGlobally: boolean;
    /** The last email's roles, in its order, while it is recent (`emailedToPin`). */
    emailedIds: string[];
    /**
     * While it's on: whether the saved résumé is one the run can rank (a
     * structured résumé with a role or skills, collect.ts). `false` means no
     * email can go out until it is. `null` while off.
     */
    resumeReady: boolean | null;
    /** With `resumeReady: false`: a résumé is saved but needs a paid month to open, so "upload it" would be the wrong advice. */
    resumeLocked?: true;
}

/** Whether the daily run can rank this account's saved résumé (`collectDailyPicks`'s own test). */
async function savedResumeState(uid: string): Promise<{ resumeReady: boolean; resumeLocked?: true }> {
    const base = await getBaseResumeForUser(uid);
    if (base.source === "locked") return { resumeReady: false, resumeLocked: true };
    return { resumeReady: base.source === "resume_data" && resumeIsUsable(base.resume_data) };
}

export async function getDailyPicksAction(): Promise<{ data?: DailyPicksView; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Sign in to get daily picks." };
    const setting = await readDailyPicksSetting(user.uid, user.email);
    return {
        data: {
            on: setting.on,
            reachable: setting.reachable,
            blockedGlobally: setting.blockedGlobally,
            emailedIds: emailedToPin({ ids: setting.state.latestIds, sentAt: setting.state.lastSentAt }, Date.now()),
            ...(setting.on ? await savedResumeState(user.uid) : { resumeReady: null }),
        },
    };
}

export async function setDailyPicksAction(on: boolean): Promise<{ success: true } | { error: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Sign in to get daily picks." };
    const result = await writeDailyPicksSetting(user.uid, user.email, on);
    return "error" in result ? result : { success: true };
}
