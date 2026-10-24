/**
 * POST /api/billing/checkout {months?: 1..12} — Stripe Checkout for prepaid months.
 * 200 {url} | 400 | 401 | 503 {error}
 */
import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getSiteUrl } from "@/lib/seo/constants";
import { parseMonths, startCheckout } from "@/lib/billing/checkout";
import { isBillingConfigured, readPriceId } from "@/lib/billing/config";
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

    let raw: unknown;
    try {
        raw = ((await request.json()) as { months?: unknown } | null)?.months;
    } catch {
        raw = undefined; // an empty body means the default one month
    }
    const months = parseMonths(raw);
    if (months === null) {
        return NextResponse.json({ error: "months must be a whole number from 1 to 12" }, { status: 400 });
    }

    const result = await startCheckout(
        {
            stripe,
            readCustomerId: async (uid) => (await readProfileBilling(uid)).stripeCustomerId,
            storeCustomerId: writeStripeCustomerId,
            log: (line) => console.error(line),
        },
        { uid: user.uid, months, priceId: readPriceId(), origin: getSiteUrl() },
    );
    return NextResponse.json(result.body, { status: result.status });
}
