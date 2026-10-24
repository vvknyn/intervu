/**
 * POST /api/webhooks/stripe — recomputes paid access when a payment settles or is refunded.
 */
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { findUidByStripeCustomerId } from "@/lib/billing/profile-store";
import { readIdField } from "@/lib/billing/events";
import { getStripe } from "@/lib/billing/stripe-client";
import { recomputeAccess } from "@/lib/billing/recompute";
import { handleStripeWebhook } from "@/lib/billing/webhook-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
    const result = await handleStripeWebhook({
        payload: await request.text(),
        signature: request.headers.get("stripe-signature"),
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        constructEvent: (body, sig, secret) => Stripe.webhooks.constructEvent(body, sig, secret) as Stripe.Event,
        deps: {
            findUidByCustomerId: findUidByStripeCustomerId,
            recompute: recomputeAccess,
            customerIdOfCharge: async (chargeId) => {
                const customer = (await getStripe()?.charges.retrieve(chargeId))?.customer;
                return readIdField(customer);
            },
            log: (line) => console.warn(line),
        },
    });
    return NextResponse.json(result.body, { status: result.status });
}
