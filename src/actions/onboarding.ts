"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { createMmdbCountryLookup } from "@/lib/geo/ip-country";
import { getClientIp } from "@/lib/shield/client-ip";
import { readOnboardingView, updateOnboarding, type OnboardingView } from "@/lib/onboarding/store";
import { SETUP_STEPS, type OnboardingPatch, type OnboardingRecord, type SetupStep } from "@/lib/onboarding/state";

export type { OnboardingView } from "@/lib/onboarding/store";

// Lazily opened and memoized for the life of the process, as /api/geo/region does.
const lookupCountry = createMmdbCountryLookup();

/**
 * Both actions name the account the browser thinks it is signed in as. The
 * browser keeps setup per account, so an answer for another account (the
 * session changed in another tab) is refused rather than kept under the
 * wrong one.
 */
const ANOTHER_ACCOUNT = "Signed in as another account";

/**
 * The signed-in account's setup, or null when it has none (made before setup
 * existed). The connection's country is looked up per request to prefill
 * step 2 and is never stored.
 */
export async function getOnboardingAction(uid: string): Promise<{ data?: OnboardingView | null; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };
    if (user.uid !== uid) return { error: ANOTHER_ACCOUNT };
    try {
        return { data: await readOnboardingView(user.uid, async () => lookupCountry(await getClientIp())) };
    } catch (error) {
        console.error("[onboarding] read failed:", error);
        return { error: "Couldn't load setup" };
    }
}

/** Only the fields a patch may carry, so a crafted call can't write anything else. */
function cleanPatch(input: unknown): OnboardingPatch {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const patch: OnboardingPatch = {};
    const step = raw.step as Record<string, unknown> | undefined;
    if (
        step &&
        (SETUP_STEPS as readonly unknown[]).includes(step.step) &&
        (step.outcome === "done" || step.outcome === "skipped")
    ) {
        patch.step = { step: step.step as SetupStep, outcome: step.outcome };
    }
    if (typeof raw.stripDay === "string") patch.stripDay = raw.stripDay;
    if (typeof raw.laterDay === "string") patch.laterDay = raw.laterDay;
    if (raw.finish === true) patch.finish = true;
    return patch;
}

export async function updateOnboardingAction(
    uid: string,
    input: OnboardingPatch,
): Promise<{ data?: OnboardingRecord | null; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };
    if (user.uid !== uid) return { error: ANOTHER_ACCOUNT };
    try {
        return { data: await updateOnboarding(user.uid, cleanPatch(input)) };
    } catch (error) {
        console.error("[onboarding] write failed:", error);
        return { error: "Couldn't save that" };
    }
}
