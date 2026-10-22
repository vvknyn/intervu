import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildCheckoutSessionParams,
    buildPortalSessionParams,
    createCheckoutSession,
    makeIntegrationIdentifier,
} from "../../src/lib/billing/sessions";
import { VELAI_UID_METADATA_KEY } from "../../src/lib/billing/events";
import { handleStripeWebhook } from "../../src/lib/billing/webhook-handler";
import { emptyBillingRecord } from "../../src/lib/billing/events";

describe("makeIntegrationIdentifier", () => {
    it("builds velai_checkout_ prefix with 8 lowercase letters", () => {
        assert.equal(makeIntegrationIdentifier("abcdefgh"), "velai_checkout_abcdefgh");
        assert.equal(typeof makeIntegrationIdentifier("ABCdefgh"), "object");
    });
});

describe("buildCheckoutSessionParams", () => {
    const base = {
        uid: "user_01",
        priceId: "price_123",
        allowedPriceIds: ["price_123"],
        successUrl: "https://velai.app/billing/success",
        cancelUrl: "http://localhost:3000/cancel",
        integrationIdentifier: "velai_checkout_abcdefgh",
    };

    it("builds subscription checkout with metadata and flexible billing_mode", () => {
        const params = buildCheckoutSessionParams({
            ...base,
            customerId: "cus_1",
        });
        assert.ok(!("error" in params));
        if ("error" in params) return;
        assert.equal(params.mode, "subscription");
        assert.equal(params.client_reference_id, "user_01");
        assert.deepEqual(params.line_items, [{ price: "price_123", quantity: 1 }]);
        assert.equal("payment_method_types" in params, false);
        assert.equal((params as { automatic_tax?: unknown }).automatic_tax, undefined);
        assert.equal(params.integration_identifier, "velai_checkout_abcdefgh");
        assert.equal(params.customer, "cus_1");
        assert.equal(params.customer_email, undefined);
        assert.equal(params.subscription_data?.metadata?.[VELAI_UID_METADATA_KEY], "user_01");
        assert.deepEqual(params.subscription_data?.billing_mode, { type: "flexible" });
    });

    it("uses customer_email when no customer id", () => {
        const params = buildCheckoutSessionParams({
            ...base,
            email: "a@example.com",
        });
        assert.ok(!("error" in params));
        if ("error" in params) return;
        assert.equal(params.customer_email, "a@example.com");
        assert.equal(params.customer, undefined);
    });

    it("rejects unknown price and empty allowlist without calling Stripe", async () => {
        const empty = buildCheckoutSessionParams({ ...base, allowedPriceIds: [] });
        assert.equal("error" in empty && empty.error, "empty_allowlist");

        const unknown = buildCheckoutSessionParams({
            ...base,
            priceId: "price_other",
        });
        assert.equal("error" in unknown && unknown.error, "unknown_price");

        let called = false;
        const result = await createCheckoutSession(
            {
                checkout: {
                    sessions: {
                        create: async () => {
                            called = true;
                            return { id: "cs_x", url: "https://checkout.stripe.com/x" };
                        },
                    },
                },
            },
            { ...base, priceId: "price_bad" },
        );
        assert.equal("error" in result && result.error, "unknown_price");
        assert.equal(called, false);
    });

    it("records params passed to the fake Stripe client", async () => {
        let captured: unknown;
        const result = await createCheckoutSession(
            {
                checkout: {
                    sessions: {
                        create: async (params) => {
                            captured = params;
                            return { id: "cs_test", url: "https://checkout.stripe.com/cs_test" };
                        },
                    },
                },
            },
            { ...base, email: "x@example.com" },
        );
        assert.ok(!("error" in result));
        assert.ok(captured && typeof captured === "object");
        assert.equal((captured as { mode?: string }).mode, "subscription");
    });
});

describe("buildPortalSessionParams", () => {
    it("is exactly customer and return_url", () => {
        const params = buildPortalSessionParams({
            customerId: "cus_1",
            returnUrl: "https://velai.app/settings",
        });
        assert.ok(!("error" in params));
        if ("error" in params) return;
        assert.deepEqual(params, {
            customer: "cus_1",
            return_url: "https://velai.app/settings",
        });
    });
});

describe("handleStripeWebhook", () => {
    const NOW = "2026-01-15T12:00:00.000Z";

    it("returns 503 when webhook secret is missing", async () => {
        const result = await handleStripeWebhook({
            payload: "{}",
            signature: "sig",
            webhookSecret: "",
            constructEvent: () => ({}),
            store: {
                findUidByCustomerId: async () => null,
                readBilling: async () => null,
                writeBilling: async () => {},
            },
            nowIso: NOW,
        });
        assert.equal(result.status, 503);
        assert.equal(result.body.error, "not_configured");
    });

    it("returns 400 on bad signature and does not write", async () => {
        let wrote = false;
        const result = await handleStripeWebhook({
            payload: "{}",
            signature: "sig",
            webhookSecret: "whsec_test",
            constructEvent: () => {
                throw new Error("bad sig");
            },
            store: {
                findUidByCustomerId: async () => null,
                readBilling: async () => null,
                writeBilling: async () => {
                    wrote = true;
                },
            },
            nowIso: NOW,
        });
        assert.equal(result.status, 400);
        assert.equal(result.body.error, "invalid_signature");
        assert.equal(wrote, false);
    });

    it("persists entitled true on subscription.updated happy path", async () => {
        let written: unknown;
        const result = await handleStripeWebhook({
            payload: "{}",
            signature: "sig",
            webhookSecret: "whsec_test",
            constructEvent: () => ({
                type: "customer.subscription.updated",
                created: 100,
                data: {
                    object: {
                        id: "sub_1",
                        customer: "cus_1",
                        status: "active",
                        current_period_end: 9999,
                        metadata: { velai_uid: "user_1" },
                    },
                },
            }),
            store: {
                findUidByCustomerId: async () => "user_1",
                readBilling: async () => emptyBillingRecord(NOW),
                writeBilling: async (_uid, record) => {
                    written = record;
                },
            },
            nowIso: NOW,
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.received, true);
        assert.equal((written as { billing_entitled?: boolean })?.billing_entitled, true);
    });

    it("payment_failed keeps entitled true on existing record", async () => {
        let written: unknown;
        await handleStripeWebhook({
            payload: "{}",
            signature: "sig",
            webhookSecret: "whsec_test",
            constructEvent: () => ({
                type: "invoice.payment_failed",
                created: 200,
                data: { object: { customer: "cus_1" } },
            }),
            store: {
                findUidByCustomerId: async () => "user_1",
                readBilling: async () => ({
                    ...emptyBillingRecord(NOW),
                    billing_entitled: true,
                    stripe_subscription_status: "active",
                    billing_event_created: 150,
                }),
                writeBilling: async (_uid, record) => {
                    written = record;
                },
            },
            nowIso: NOW,
        });
        assert.equal((written as { billing_entitled?: boolean })?.billing_entitled, true);
        assert.ok((written as { stripe_last_payment_failed_at?: string })?.stripe_last_payment_failed_at);
    });
});
