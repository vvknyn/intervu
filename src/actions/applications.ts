"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { keepGuestAppliedResume, readAppliedResume, removeAppliedResume } from "@/lib/pursuits/applied-resume";
import type { PAYMENT_REQUIRED } from "@/lib/billing/access";
import type { AppliedResume } from "@/lib/pursuits/types";

/** The résumé a role kept when it was marked Applied, with its text, for
 *  Download: the tracker list sends only its date (`getApplications`). */
export async function fetchAppliedResumeAction(pursuitId: string): Promise<{ data?: AppliedResume; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };
    if (typeof pursuitId !== "string" || !pursuitId) return { error: "Pursuit not found" };
    return readAppliedResume(user.uid, pursuitId);
}

/** Removes that copy from the role; the résumé itself stays. */
export async function removeAppliedResumeAction(pursuitId: string): Promise<{ error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };
    if (typeof pursuitId !== "string" || !pursuitId) return { error: "Pursuit not found" };
    return removeAppliedResume(user.uid, pursuitId);
}

/** Sign-in carries a guest role's copy onto the account's role. */
export async function keepGuestAppliedResumeAction(pursuitId: string, copy: AppliedResume): Promise<{ error?: string; code?: typeof PAYMENT_REQUIRED }> {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };
    if (typeof pursuitId !== "string" || !pursuitId) return { error: "Pursuit not found" };
    return keepGuestAppliedResume(user.uid, pursuitId, copy);
}
