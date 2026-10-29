/**
 * POST /api/billing/checkout {months?: 1..12} — Stripe Checkout for prepaid months.
 * POST /api/billing/checkout {autoRenew: true} — Stripe Checkout for month-to-month billing.
 * 200 {url} | 400 | 401 | 409 | 503 {error}
 */
import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getSiteUrl } from "@/lib/seo/constants";
import { parseMonths, startCheckout, startSubscriptionCheckout } from "@/lib/billing/checkout";
import { isAutoRenewConfigured, isBillingConfigured, readPriceId, readSubscriptionPriceId } from "@/lib/billing/config";
import { validateVelaiUid } from "@/lib/billing/events";
import { readProfileBilling, writeStripeCustomerId } from "@/lib/billing/profile-store";
import { getStripe } from "@/lib/billing/stripe-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
    const user = await getServerUser();
    if (!user || !validateVelaiUid(user.uid)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const stripe = getStripe();
    if (!stripe || !isBillingConfigured()) {
        return NextResponse.json({ error: "Payments open soon." }, { status: 503 });
    }

    // An empty body means the default one prepaid month.
    const body = await request.json().then(
        (parsed) => parsed as { months?: unknown; autoRenew?: unknown } | null,
        () => null,
    );

    const deps = {
        stripe,
        readCustomerId: async (uid: string) => (await readProfileBilling(uid)).stripeCustomerId,
        storeCustomerId: writeStripeCustomerId,
        log: (line: string) => console.error(line),
    };

    if (body?.autoRenew === true) {
        if (!isAutoRenewConfigured()) {
            return NextResponse.json({ error: "Month to month opens soon." }, { status: 503 });
        }
        const result = await startSubscriptionCheckout(deps, { uid: user.uid, priceId: readSubscriptionPriceId(), origin: getSiteUrl() });
        return NextResponse.json(result.body, { status: result.status });
    }

    const months = parseMonths(body?.months);
    if (months === null) {
        return NextResponse.json({ error: "months must be a whole number from 1 to 12" }, { status: 400 });
    }

    const result = await startCheckout(deps, { uid: user.uid, months, priceId: readPriceId(), origin: getSiteUrl() });
    return NextResponse.json(result.body, { status: result.status });
}
