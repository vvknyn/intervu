"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { getAccessUntil } from "@/lib/billing/access";
import { planSummary, type PlanSummary } from "@/lib/billing/plan";
import { readProfileBilling } from "@/lib/billing/profile-store";

/**
 * This account's plan, for the Settings card and the ending-soon notice. Both mount only for a
 * signed-in client, so no session here is a mismatch, and a failed read likewise is `{error}`,
 * never "free": a paid account must not be told it has no plan.
 */
export async function fetchPlanAction(): Promise<{ plan?: PlanSummary; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "no-session" };
    try {
        const [accessUntil, { grants }] = await Promise.all([getAccessUntil(user.uid), readProfileBilling(user.uid)]);
        return { plan: planSummary({ accessUntil, grants, now: Date.now() }) };
    } catch {
        return { error: "Couldn't load your plan" };
    }
}
