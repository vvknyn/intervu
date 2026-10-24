/**
 * The paid-tier refusal for a connected AI. Free tools (search, jobs,
 * companies, tracker, preferences) run for any account; a tool registered
 * with `needsPaid` (route.ts `withDeps`) touches the stored résumé or AI over
 * it, so an account without a paid month gets this instead. Matched by the
 * option, not a tool-name list, so a new résumé tool is gated by declaring it.
 */
import { hasPaidAccess, paymentRequired } from "@/lib/billing/access";
import { getSiteUrl } from "@/lib/seo/constants";

/** The refusal payload, or null when the tool may run. */
export async function paywallRefusal(
    needsPaid: boolean | undefined,
    uid: string,
    isPaid: (uid: string) => Promise<boolean> = hasPaidAccess,
): Promise<{ error: string; code: ReturnType<typeof paymentRequired>["code"] } | null> {
    if (!needsPaid || (await isPaid(uid))) return null;
    const { error, code } = paymentRequired();
    return { error: `${error} Add a month at ${getSiteUrl()}/pricing`, code };
}
