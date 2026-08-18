"use server";

import { cookies } from "next/headers";
import { getCreditState } from "@/lib/llm/credit-gate";
import { getUserLLMConfig } from "@/actions/profile";

const E2E_CREDITS_COOKIE = "intervu_e2e_credits";

async function readE2EMockCredits(): Promise<{
    isAdmin: boolean;
    isBYOK: boolean;
    allowance: number;
    earned: number;
    total: number;
    monthlyFree: number;
} | null> {
    if (process.env.NODE_ENV === "production") return null;
    const raw = (await cookies()).get(E2E_CREDITS_COOKIE)?.value;
    if (!raw) return null;
    try {
        return JSON.parse(decodeURIComponent(raw));
    } catch {
        return null;
    }
}

/**
 * Current user's AI-credit state for the balance indicator.
 *  - isAdmin: unlimited shared-model use (vvk / allowlist).
 *  - isBYOK:  uses their own key → credits don't apply (never charged).
 *  - allowance: remaining free generations this month (resets monthly).
 *  - earned: permanent credits (referral rewards, welcome grant, future
 *    purchases) that never reset.
 *  - total: allowance + earned — what a spend actually draws against.
 *    (Only meaningful when !isAdmin && !isBYOK. Infinity (admin) is coerced
 *    away so it survives server-action serialization; the client keys off
 *    the flags instead.)
 */
export async function getMyCreditsAction(): Promise<{
    isAdmin: boolean;
    isBYOK: boolean;
    allowance: number;
    earned: number;
    total: number;
    monthlyFree: number;
}> {
    const e2eMock = await readE2EMockCredits();
    if (e2eMock) return e2eMock;

    const [state, userKey] = await Promise.all([getCreditState(), getUserLLMConfig()]);
    return {
        isAdmin: state.isAdmin,
        isBYOK: Boolean(userKey),
        allowance: Number.isFinite(state.allowance) ? state.allowance : 0,
        earned: state.earned,
        total: Number.isFinite(state.total) ? state.total : 0,
        monthlyFree: state.monthlyFree,
    };
}
