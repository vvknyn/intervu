import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isEntitledStatus, readBillingEntitlement } from "../../src/lib/billing/entitlement";
import {
    emptyBillingRecord,
    reduceBillingEvent,
    readSubscriptionPeriodEnd,
    validateVelaiUid,
    type NormalizedStripeEvent,
} from "../../src/lib/billing/events";

const NOW = "2026-01-15T12:00:00.000Z";

function ev(type: string, created: number, object: Record<string, unknown>): NormalizedStripeEvent {
    return { type, created, object };
}

describe("isEntitledStatus", () => {
    it("is true only for active and trialing", () => {
        assert.equal(isEntitledStatus("active"), true);
        assert.equal(isEntitledStatus("trialing"), true);
    });

    it("is false for all other statuses and nullish values", () => {
        for (const status of [
            "past_due",
            "canceled",
            "unpaid",
            "incomplete",
            "incomplete_expired",
            "paused",
            "unknown",
            null,
            undefined,
            "",
        ]) {
            assert.equal(isEntitledStatus(status), false);
        }
    });
});

describe("readBillingEntitlement", () => {
    it("requires billing_entitled === true", () => {
        assert.equal(readBillingEntitlement({ billing_entitled: true }), true);
        assert.equal(readBillingEntitlement({ billing_entitled: false }), false);
        assert.equal(readBillingEntitlement({}), false);
        assert.equal(readBillingEntitlement(null), false);
    });
});

describe("reduceBillingEvent — subscriptions", () => {
    it("sets entitled true on subscription.updated when status is active", () => {
        const prev = emptyBillingRecord(NOW);
        const { record } = reduceBillingEvent(
            prev,
            ev("customer.subscription.updated", 100, {
                id: "sub_1",
                customer: "cus_1",
                status: "active",
                current_period_end: 2000,
            }),
            NOW,
        );
        assert.equal(record.billing_entitled, true);
        assert.equal(record.stripe_subscription_status, "active");
        assert.equal(record.stripe_subscription_id, "sub_1");
        assert.equal(record.stripe_customer_id, "cus_1");
        assert.equal(record.stripe_current_period_end, 2000);
    });

    it("clears entitled on subscription.deleted", () => {
        const prev = {
            ...emptyBillingRecord(NOW),
            billing_entitled: true,
            stripe_subscription_status: "active",
            stripe_subscription_id: "sub_1",
            stripe_customer_id: "cus_1",
            billing_event_created: 50,
        };
        const { record } = reduceBillingEvent(
            prev,
            ev("customer.subscription.deleted", 100, {
                id: "sub_1",
                customer: "cus_1",
                status: "canceled",
            }),
            NOW,
        );
        assert.equal(record.billing_entitled, false);
        assert.equal(record.stripe_subscription_status, "canceled");
        assert.equal(record.stripe_subscription_id, "sub_1");
        assert.equal(record.stripe_customer_id, "cus_1");
    });

    it("invoice.payment_failed records timestamp without clearing entitled", () => {
        const prev = {
            ...emptyBillingRecord(NOW),
            billing_entitled: true,
            stripe_subscription_status: "active",
            billing_event_created: 90,
        };
        const { record } = reduceBillingEvent(
            prev,
            ev("invoice.payment_failed", 100, { customer: "cus_1" }),
            NOW,
        );
        assert.equal(record.billing_entitled, true);
        assert.equal(record.stripe_subscription_status, "active");
        assert.equal(record.stripe_last_payment_failed_at, "1970-01-01T00:01:40.000Z");
        assert.equal(record.billing_event_created, 90);
    });

    it("past_due clears entitled", () => {
        const prev = {
            ...emptyBillingRecord(NOW),
            billing_entitled: true,
            stripe_subscription_status: "active",
            stripe_current_period_end: 3000,
            billing_event_created: 50,
        };
        const { record } = reduceBillingEvent(
            prev,
            ev("customer.subscription.updated", 80, {
                id: "sub_1",
                customer: "cus_1",
                status: "past_due",
            }),
            NOW,
        );
        assert.equal(record.billing_entitled, false);
        assert.equal(record.stripe_subscription_status, "past_due");
        assert.equal(record.stripe_current_period_end, 3000);
    });

    it("older event does not clobber newer subscription status", () => {
        const prev = {
            ...emptyBillingRecord(NOW),
            billing_entitled: true,
            stripe_subscription_status: "active",
            stripe_current_period_end: 3000,
            stripe_subscription_id: "sub_new",
            billing_event_created: 200,
        };
        const { record } = reduceBillingEvent(
            prev,
            ev("customer.subscription.updated", 100, {
                id: "sub_old",
                customer: "cus_1",
                status: "canceled",
                current_period_end: 1000,
            }),
            NOW,
        );
        assert.equal(record.stripe_subscription_status, "active");
        assert.equal(record.stripe_subscription_id, "sub_new");
        assert.equal(record.billing_entitled, true);
        assert.equal(record.stripe_current_period_end, 3000);
        assert.equal(record.stripe_customer_id, "cus_1");
    });
});

describe("reduceBillingEvent — checkout", () => {
    it("checkout.session.completed links ids and does not entitle", () => {
        const prev = emptyBillingRecord(NOW);
        const { record, uid } = reduceBillingEvent(
            prev,
            ev("checkout.session.completed", 100, {
                customer: "cus_1",
                subscription: "sub_1",
                client_reference_id: "user_abc",
                payment_status: "paid",
            }),
            NOW,
        );
        assert.equal(uid, "user_abc");
        assert.equal(record.stripe_customer_id, "cus_1");
        assert.equal(record.stripe_subscription_id, "sub_1");
        assert.equal(record.billing_entitled, false);
        assert.equal(record.billing_event_created, 0);
    });

    it("a later checkout does not block an earlier subscription.created from entitling", () => {
        const afterCheckout = reduceBillingEvent(
            emptyBillingRecord(NOW),
            ev("checkout.session.completed", 200, {
                customer: "cus_1",
                subscription: "sub_1",
                client_reference_id: "user_abc",
                payment_status: "paid",
            }),
            NOW,
        );
        const { record } = reduceBillingEvent(
            afterCheckout.record,
            ev("customer.subscription.created", 100, {
                id: "sub_1",
                customer: "cus_1",
                status: "active",
                current_period_end: 4000,
                metadata: { velai_uid: "user_abc" },
            }),
            NOW,
        );
        assert.equal(record.billing_entitled, true);
        assert.equal(record.stripe_subscription_status, "active");
        assert.equal(record.stripe_current_period_end, 4000);
        assert.equal(record.billing_event_created, 100);
    });

    it("unpaid checkout still links customer and does not entitle", () => {
        const prev = emptyBillingRecord(NOW);
        const { record } = reduceBillingEvent(
            prev,
            ev("checkout.session.completed", 100, {
                customer: "cus_1",
                subscription: "sub_1",
                client_reference_id: "user_abc",
                payment_status: "unpaid",
            }),
            NOW,
        );
        assert.equal(record.stripe_customer_id, "cus_1");
        assert.equal(record.billing_entitled, false);
    });

    it("invalid client_reference_id does not yield a uid", () => {
        const { uid } = reduceBillingEvent(
            emptyBillingRecord(NOW),
            ev("checkout.session.completed", 100, {
                customer: "cus_1",
                client_reference_id: "bad uid",
            }),
            NOW,
        );
        assert.equal(uid, null);
    });
});

describe("readSubscriptionPeriodEnd", () => {
    it("uses minimum item period end when root is absent", () => {
        const end = readSubscriptionPeriodEnd({
            items: {
                data: [{ current_period_end: 5000 }, { current_period_end: 4000 }],
            },
        });
        assert.equal(end, 4000);
    });
});

describe("validateVelaiUid", () => {
    it("accepts WorkOS-shaped uids", () => {
        assert.equal(validateVelaiUid("user_01ABC-def"), "user_01ABC-def");
    });
});
