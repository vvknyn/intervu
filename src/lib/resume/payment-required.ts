/**
 * What the browser does with the server's "this needs a paid month" refusal
 * (`paymentRequired()`, lib/billing/access.ts) on a résumé save: keep the
 * on-device copy, say so once with a way to the pricing page, and never offer
 * a retry that can't succeed. Client-safe: the code is matched here with a
 * type-only import, because access.ts itself reads the profile store (server).
 */
import type { PAYMENT_REQUIRED } from "@/lib/billing/access";
import { toast, type ToastAction } from "@/lib/toast";

export const PRICING_HREF = "/pricing";
export const KEPT_ON_DEVICE_MESSAGE = "Kept on this device. Saving to your account needs a paid month.";

/** `satisfies` ties this literal to the server's: if the code changes, this stops compiling. */
const CODE = "payment_required" satisfies typeof PAYMENT_REQUIRED;

const PRICING_ACTION: ToastAction = { label: "See pricing", onClick: () => window.location.assign(PRICING_HREF) };

/** What the browser answers itself when it knows the account is unpaid and so never sends: the server's refusal, without the trip. */
export function unpaidRefusal(): { error: string; code: typeof CODE } {
    return { error: KEPT_ON_DEVICE_MESSAGE, code: CODE };
}

export function isPaymentRequired(res: { code?: string } | null | undefined): boolean {
    return res?.code === CODE;
}

/** The info toast for a refused save: the copy stays on this device, with a link to pricing. */
export function toastKeptOnDevice(): void {
    toast.info(KEPT_ON_DEVICE_MESSAGE, 8000, PRICING_ACTION);
}

/** The info toast for a saved copy whose text the server withheld: reading it back is the paid month. */
export function toastReadNeedsPaidMonth(): void {
    toast.info("Reading a saved résumé back needs a paid month.", 8000, PRICING_ACTION);
}

/** A refusal that must travel as a thrown error (the editor's save), still recognisable as a paywall. */
export class PaymentRequiredError extends Error {}

/** The error to throw for a failed server result: a paywall one when the server said so. */
export function failureOf(res: { error: string; code?: string }): Error {
    return isPaymentRequired(res) ? new PaymentRequiredError(res.error) : new Error(res.error);
}

/** The error toast for a failed save; a paywall refusal also links to pricing. */
export function toastFailure(error: unknown, fallback: string): void {
    const message = error instanceof Error ? error.message : fallback;
    toast.error(message, error instanceof PaymentRequiredError ? 8000 : undefined, error instanceof PaymentRequiredError ? PRICING_ACTION : undefined);
}
