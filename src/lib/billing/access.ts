/**
 * The ONE server-side paid-access check. Access = the stored `access_until` (epoch ms),
 * written only by the billing recompute from payments + dated grants.
 */
import { readProfile } from "@/lib/billing/profile-store";

export const PAYMENT_REQUIRED = "payment_required" as const;

export function paymentRequired(): { error: string; code: typeof PAYMENT_REQUIRED } {
    return { error: "Saving your résumé and AI help need a paid month.", code: PAYMENT_REQUIRED };
}

function epochMs(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function accessUntil(profile: { access_until?: unknown } | null | undefined): number {
    return epochMs(profile?.access_until);
}

/** Epoch ms the account is paid through (0 = never). A read error throws. */
export async function getAccessUntil(uid: string): Promise<number> {
    return accessUntil(await readProfile(uid));
}

export async function hasPaidAccess(uid: string, now: number = Date.now()): Promise<boolean> {
    return (await getAccessUntil(uid)) > now;
}
