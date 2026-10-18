/**
 * POST /api/billing/checkout — Stripe Checkout session (server-only; no UI wired).
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { isCheckoutConfigured, readStripeBillingEnv } from "@/lib/billing/config";
import { readBillingRecord } from "@/lib/billing/profile-store";
import { validateVelaiUid } from "@/lib/billing/events";
import { createCheckoutSession, makeIntegrationIdentifier } from "@/lib/billing/sessions";
import { getStripe } from "@/lib/billing/stripe-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
    const user = await getServerUser();
    if (!user) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const env = readStripeBillingEnv(process.env);
    const stripe = getStripe();
    if (!stripe || !isCheckoutConfigured(env)) {
        return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }

    let body: { priceId?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "unknown_price" }, { status: 400 });
    }

    const priceId = typeof body.priceId === "string" ? body.priceId.trim() : "";
    if (!priceId || !env.priceIds.includes(priceId)) {
        return NextResponse.json({ error: "unknown_price" }, { status: 400 });
    }

    if (!validateVelaiUid(user.uid)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const billing = await readBillingRecord(user.uid);
    const integrationSuffix = randomBytes(8).reduce(
        (acc, byte) => acc + String.fromCharCode(97 + (byte % 26)),
        "",
    );
    const integrationId = makeIntegrationIdentifier(integrationSuffix);
    if (typeof integrationId !== "string") {
        return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }

    const session = await createCheckoutSession(stripe, {
        uid: user.uid,
        priceId,
        allowedPriceIds: env.priceIds,
        successUrl: env.checkoutSuccessUrl!,
        cancelUrl: env.checkoutCancelUrl!,
        integrationIdentifier: integrationId,
        customerId: billing?.stripe_customer_id,
        email: user.email,
    });

    if ("error" in session) {
        if (session.error === "unknown_price" || session.error === "empty_allowlist") {
            return NextResponse.json({ error: "unknown_price" }, { status: 400 });
        }
        return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }

    return NextResponse.json({ url: session.url, id: session.id });
}
