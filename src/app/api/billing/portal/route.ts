/**
 * POST /api/billing/portal — a link to Stripe's hosted billing page for this account
 * (update the card, cancel month to month, see invoices).
 * 200 {url} | 401 | 404 | 503 {error}
 */
import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getSiteUrl } from "@/lib/seo/constants";
import { startPortal } from "@/lib/billing/checkout";
import { isBillingConfigured } from "@/lib/billing/config";
import { validateVelaiUid } from "@/lib/billing/events";
import { readProfileBilling } from "@/lib/billing/profile-store";
import { getStripe } from "@/lib/billing/stripe-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAVAILABLE = "The billing page isn't available right now. Try again later.";

export async function POST(): Promise<NextResponse> {
    const user = await getServerUser();
    if (!user || !validateVelaiUid(user.uid)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const stripe = getStripe();
    if (!stripe || !isBillingConfigured()) {
        return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
    }

    try {
        const result = await startPortal(
            { stripe, readCustomerId: async (uid) => (await readProfileBilling(uid)).stripeCustomerId },
            { uid: user.uid, origin: getSiteUrl() },
        );
        return NextResponse.json(result.body, { status: result.status });
    } catch (error) {
        // Stripe refuses until the portal is switched on in the Dashboard; the reason goes to the log, not the page.
        console.error(`[billing-portal] ${error instanceof Error ? error.message : "failed"}`);
        return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
    }
}
