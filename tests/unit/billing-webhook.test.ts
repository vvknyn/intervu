import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleStripeWebhook, type WebhookDeps } from "../../src/lib/billing/webhook-handler";

function run(event: unknown, over: Partial<{ webhookSecret: string; signature: string | null; known: string | null; fail: boolean; chargeCustomer: string | null }> = {}) {
    const calls: string[][] = [];
    const logs: string[] = [];
    const lookups: string[] = [];
    const deps: WebhookDeps = {
        customerIdOfCharge: async (chargeId) => {
            lookups.push(chargeId);
            return over.chargeCustomer === undefined ? null : over.chargeCustomer;
        },
        log: (line) => logs.push(line),
        findUidByCustomerId: async () => (over.known === undefined ? null : over.known),
        recompute: async (uid, cus) => {
            if (over.fail) throw new Error("boom");
            calls.push([uid, cus]);
        },
    };
    return handleStripeWebhook({
        payload: "{}",
        signature: over.signature === undefined ? "sig" : over.signature,
        webhookSecret: over.webhookSecret === undefined ? "whsec" : over.webhookSecret,
        constructEvent: () => event,
        deps,
    }).then((result) => ({ result, calls, logs, lookups }));
}
const session = (type: string) => ({ type, data: { object: { customer: "cus_1", client_reference_id: "uid_1" } } });

describe("stripe webhook", () => {
    it("dispatches checkout.session.completed and async_payment_succeeded via client_reference_id", async () => {
        for (const type of ["checkout.session.completed", "checkout.session.async_payment_succeeded"]) {
            const { result, calls } = await run(session(type));
            assert.equal(result.status, 200);
            assert.deepEqual(calls, [["uid_1", "cus_1"]]);
        }
    });
    it("dispatches charge.refunded by the customer already on file, ignoring metadata", async () => {
        const event = { type: "charge.refunded", data: { object: { customer: "cus_1", metadata: { velai_uid: "uid_meta" } } } };
        const { calls } = await run(event, { known: "uid_known" });
        assert.deepEqual(calls, [["uid_known", "cus_1"]]);
    });
    it("charge.refunded falls back to the velai_uid metadata", async () => {
        const event = { type: "charge.refunded", data: { object: { customer: "cus_1", metadata: { velai_uid: "uid_meta" } } } };
        assert.deepEqual((await run(event)).calls, [["uid_meta", "cus_1"]]);
    });
    it("dispatches the month-to-month events: a paid renewal and a subscription that changed or ended", async () => {
        for (const type of ["invoice.paid", "customer.subscription.updated", "customer.subscription.deleted"]) {
            const { result, calls } = await run({ type, data: { object: { customer: "cus_1", metadata: { velai_uid: "uid_meta" } } } });
            assert.equal(result.status, 200);
            assert.deepEqual(calls, [["uid_meta", "cus_1"]], type);
        }
    });
    it("an invoice names its account through the subscription's metadata when the customer is not on file", async () => {
        const object = { customer: "cus_1", metadata: {}, parent: { type: "subscription_details", subscription_details: { metadata: { velai_uid: "uid_sub" } } } };
        assert.deepEqual((await run({ type: "invoice.paid", data: { object } })).calls, [["uid_sub", "cus_1"]]);
        assert.deepEqual((await run({ type: "invoice.paid", data: { object } }, { known: "uid_known" })).calls, [["uid_known", "cus_1"]]);
    });
    it("acknowledges but ignores every other event type, including a failed renewal (the subscription update that follows it recomputes)", async () => {
        for (const type of ["invoice.payment_failed", "invoice.created", "checkout.session.async_payment_failed"]) {
            const { result, calls } = await run(session(type));
            assert.equal(result.status, 200);
            assert.equal(calls.length, 0);
        }
    });
    it("drops an event whose uid is malformed and unknown, logging counts only", async () => {
        const event = { type: "checkout.session.completed", data: { object: { customer: "cus_1", client_reference_id: "bad uid!", metadata: { velai_uid: "bad uid!" } } } };
        const { calls, logs } = await run(event);
        assert.equal(calls.length, 0);
        assert.equal(logs.length, 1);
        assert.doesNotMatch(logs[0], /cus_1|bad uid|@/);
    });
    it("a malformed client_reference_id falls back to the valid metadata uid; a valid one still wins", async () => {
        const object = { customer: "cus_1", client_reference_id: "bad uid!", metadata: { velai_uid: "uid_meta" } };
        assert.deepEqual((await run({ type: "checkout.session.completed", data: { object } })).calls, [["uid_meta", "cus_1"]]);
        const both = { ...object, client_reference_id: "uid_ref" };
        assert.deepEqual((await run({ type: "checkout.session.completed", data: { object: both } })).calls, [["uid_ref", "cus_1"]]);
    });
    it("an event with no customer is acknowledged, logged and recomputes nothing", async () => {
        const { result, calls, logs } = await run({ type: "checkout.session.completed", data: { object: { client_reference_id: "uid_1" } } });
        assert.equal(result.status, 200);
        assert.equal(calls.length, 0);
        assert.equal(logs.length, 1);
    });
    it("a closed dispute resolves its charge's customer and recomputes (lost or won: the recompute decides)", async () => {
        const event = { type: "charge.dispute.closed", data: { object: { charge: "ch_1", status: "lost" } } };
        const { calls, lookups } = await run(event, { chargeCustomer: "cus_9", known: "uid_known" });
        assert.deepEqual(lookups, ["ch_1"]);
        assert.deepEqual(calls, [["uid_known", "cus_9"]]);
        const won = { type: "charge.dispute.closed", data: { object: { charge: { id: "ch_2" }, status: "won" } } };
        assert.deepEqual((await run(won, { chargeCustomer: "cus_9", known: "uid_known" })).lookups, ["ch_2"]);
    });
    it("a dispute whose charge has no customer is logged, not recomputed", async () => {
        const { calls, logs } = await run({ type: "charge.dispute.closed", data: { object: { charge: "ch_1" } } });
        assert.equal(calls.length, 0);
        assert.equal(logs.length, 1);
    });
    it("503 without a secret, 400 without a signature, 500 (retry) when the recompute fails", async () => {
        assert.equal((await run(session("checkout.session.completed"), { webhookSecret: "" })).result.status, 503);
        assert.equal((await run(session("checkout.session.completed"), { signature: null })).result.status, 400);
        assert.equal((await run(session("checkout.session.completed"), { fail: true })).result.status, 500);
    });
});
