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

/**
 * A month-to-month renewal is charged a little after the paid month ends. While the account's
 * subscription is live, the stored end carries this slack so paid features don't blink off
 * while the charge settles; `paidThrough` takes it back out of every date shown.
 */
export const RENEWAL_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

export function paidThrough(storedEnd: number, autoRenew: boolean): number {
    return autoRenew && storedEnd > 0 ? storedEnd - RENEWAL_GRACE_MS : storedEnd;
}

/** True while the account has a live month-to-month subscription, as the last recompute saw it. */
export function autoRenewOn(profile: { auto_renew?: unknown } | null | undefined): boolean {
    return profile?.auto_renew === true;
}

/** What /pricing shows of a profile: the date it is paid through (next payment while month to month is live), null when lapsed. */
export function paidSummary(
    profile: { access_until?: unknown; auto_renew?: unknown } | null | undefined,
    now: number = Date.now(),
): { paidUntil: number | null; autoRenewing: boolean } {
    const stored = accessUntil(profile);
    const autoRenewing = autoRenewOn(profile);
    const shown = paidThrough(stored, autoRenewing);
    return { paidUntil: stored > now && shown > now ? shown : null, autoRenewing };
}

/** Epoch ms the account is paid through (0 = never). A read error throws. */
export async function getAccessUntil(uid: string): Promise<number> {
    return accessUntil(await readProfile(uid));
}

export async function hasPaidAccess(uid: string, now: number = Date.now()): Promise<boolean> {
    return (await getAccessUntil(uid)) > now;
}
