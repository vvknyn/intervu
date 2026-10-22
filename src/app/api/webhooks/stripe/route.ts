/**
 * POST /api/webhooks/stripe — subscription billing state from Stripe events.
 */
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { billingProfileStore } from "@/lib/billing/profile-store";
import { handleStripeWebhook } from "@/lib/billing/webhook-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
    const payload = await request.text();
    const signature = request.headers.get("stripe-signature");

    const result = await handleStripeWebhook({
        payload,
        signature,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        constructEvent: (body, sig, secret) =>
            Stripe.webhooks.constructEvent(body, sig, secret) as Stripe.Event,
        store: billingProfileStore,
        nowIso: new Date().toISOString(),
    });

    return NextResponse.json(result.body, { status: result.status });
}
