/**
 * The paid-tier gate for the stored résumé (P2: saving it, reading it back, AI
 * over it are the paid month). One check, `hasPaidAccess`; this is only the
 * two shapes every stored-résumé site needs, so each site is one line:
 * a read answers "none" to an unpaid account (callers then take their
 * on-device branch, like a guest), a write refuses with the typed
 * `paymentRequired()`. `isPaid` is injectable so the decision tests without a
 * profile store.
 */
import { hasPaidAccess, paymentRequired } from "@/lib/billing/access";

type IsPaid = (uid: string) => Promise<boolean>;

/** Runs the read for a paid account; an unpaid one gets `none`, and the read never runs. */
export async function whenPaid<T>(uid: string, read: () => Promise<T>, none: T, isPaid: IsPaid = hasPaidAccess): Promise<T> {
    return (await isPaid(uid)) ? read() : none;
}

/** The refusal an unpaid account's write gets; null when the write may go ahead. */
export async function refuseUnpaid(uid: string, isPaid: IsPaid = hasPaidAccess): Promise<ReturnType<typeof paymentRequired> | null> {
    return (await isPaid(uid)) ? null : paymentRequired();
}
