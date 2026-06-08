"use server";

import { getCreditState } from "@/lib/llm/credit-gate";
import { getUserLLMConfig } from "@/actions/profile";

/**
 * Current user's AI-credit state for the balance indicator.
 *  - isAdmin: unlimited shared-model use (vvk / allowlist).
 *  - isBYOK:  uses their own key → credits don't apply (never charged).
 *  - credits: remaining free generations this month (only meaningful when
 *    !isAdmin && !isBYOK). Infinity (admin) is coerced away so it survives
 *    server-action serialization; the client keys off the flags instead.
 */
export async function getMyCreditsAction(): Promise<{
    isAdmin: boolean;
    isBYOK: boolean;
    credits: number;
    monthlyFree: number;
}> {
    const [state, userKey] = await Promise.all([getCreditState(), getUserLLMConfig()]);
    return {
        isAdmin: state.isAdmin,
        isBYOK: Boolean(userKey),
        credits: Number.isFinite(state.credits) ? state.credits : 0,
        monthlyFree: state.monthlyFree,
    };
}
