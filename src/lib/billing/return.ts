/**
 * What /billing/return may do with a Checkout Session id from the URL. Pure.
 */
export type ReturnOutcome = "not_yours" | "paid" | "pending" | "failed";

export function decideReturn(
    session: { client_reference_id: string | null; payment_status: string; status: string | null },
    uid: string,
): ReturnOutcome {
    if (session.client_reference_id !== uid) return "not_yours";
    if (session.payment_status === "paid") return "paid";
    return session.status === "complete" ? "pending" : "failed";
}
