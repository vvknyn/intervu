"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { getAccessUntil } from "@/lib/billing/access";
import { planSummary, type PlanSummary } from "@/lib/billing/plan";
import { readProfileBilling } from "@/lib/billing/profile-store";

/**
 * This account's plan, for the Settings card and the ending-soon notice. A guest is free;
 * a failed read is `{error}`, never "free", so a paid account is not told it has no plan.
 */
export async function fetchPlanAction(): Promise<{ plan?: PlanSummary; error?: string }> {
    const user = await getServerUser();
    if (!user) return { plan: { status: "free" } };
    try {
        const [accessUntil, { grants }] = await Promise.all([getAccessUntil(user.uid), readProfileBilling(user.uid)]);
        return { plan: planSummary({ accessUntil, grants, now: Date.now() }) };
    } catch {
        return { error: "Couldn't load your plan" };
    }
}
