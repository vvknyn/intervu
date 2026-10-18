/**
 * POST /api/billing/portal — Stripe Customer Portal session (server-only; no UI wired).
 */
import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { isPortalConfigured, readStripeBillingEnv } from "@/lib/billing/config";
import { readBillingRecord } from "@/lib/billing/profile-store";
import { createPortalSession } from "@/lib/billing/sessions";
import { getStripe } from "@/lib/billing/stripe-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
    const user = await getServerUser();
    if (!user) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const env = readStripeBillingEnv(process.env);
    const stripe = getStripe();
    if (!stripe || !isPortalConfigured(env)) {
        return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }

    const billing = await readBillingRecord(user.uid);
    const customerId = billing?.stripe_customer_id?.trim();
    if (!customerId) {
        return NextResponse.json({ error: "no_customer" }, { status: 409 });
    }

    const session = await createPortalSession(stripe, {
        customerId,
        returnUrl: env.portalReturnUrl!,
    });
    if ("error" in session) {
        return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }

    return NextResponse.json({ url: session.url });
}
