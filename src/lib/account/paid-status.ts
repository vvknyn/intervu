// PARSE_GATE_EXEMPT: fetchPaidStatusAction returns one boolean about the account, never résumé text; it only decides whether text may be sent.
import { fetchPaidStatusAction } from "@/actions/paid-status";
import { unpaidRefusal } from "@/lib/resume/payment-required";

const PAID_STATUS_TTL_MS = 30_000;

/** A short-lived memo of one async paid check; any failure is `false`, so nothing is sent on a guess. Injectable clock/fetcher keeps it testable. */
export function createPaidStatusCache(
    fetcher: () => Promise<{ paid?: boolean; error?: string }>,
    now: () => number = Date.now,
): () => Promise<boolean> {
    let held: { at: number; paid: Promise<boolean> } | null = null;
    return () => {
        if (held && now() - held.at < PAID_STATUS_TTL_MS) return held.paid;
        const paid = fetcher().then((res) => res.paid === true, () => false);
        held = { at: now(), paid };
        return paid;
    };
}

export const isAccountPaid = createPaidStatusCache(fetchPaidStatusAction);

/**
 * Runs `send` (the call that carries résumé text to the server) only for an
 * account with paid time; otherwise answers the refusal the server would give,
 * so every caller's existing payment-required branch keeps the device copy.
 */
export async function sendIfPaid<T extends { error?: string; code?: string }>(send: () => Promise<T>): Promise<T | ReturnType<typeof unpaidRefusal>> {
    return (await isAccountPaid()) ? send() : unpaidRefusal();
}
