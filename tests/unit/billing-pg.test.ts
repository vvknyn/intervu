/**
 * The billing profile store on the sealed Postgres store, against a real Postgres: what velai.app
 * runs (DATA_STORE=postgres). Billing reads and writes `profiles/{uid}` through getAdminDb(), which
 * hands back this store, so the customer lookup the webhook makes, the recompute's writes, grants
 * and the reads behind Settings and /pricing all have to work through it. Skipped unless
 * DOCSTORE_TEST_PG_URL names a scratch database with deploy/db-box/intervu-schema.sql applied
 * (see tests/unit/docstore-pg.test.ts).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { Pool } from "pg";
import type Stripe from "stripe";

import { RENEWAL_GRACE_MS, paidSummary } from "../../src/lib/billing/access";
import { planSummary } from "../../src/lib/billing/plan";
import { appendGrantOnce, findUidByStripeCustomerId, readProfile, readProfileBilling, useBillingDb, writeStripeCustomerId } from "../../src/lib/billing/profile-store";
import { DAY_MS, recomputeAccess } from "../../src/lib/billing/recompute";
import { createPgDocDb, type PgDocDb } from "../../src/lib/db/docstore/pg-docstore";
import { deriveDocKeys } from "../../src/lib/db/docstore/seal";

const URL = process.env.DOCSTORE_TEST_PG_URL;
const PREFIX = "billing-pg-";
const T0 = Date.UTC(2026, 9, 1);

/** One paid month-to-month invoice, its charge and a live subscription: what Stripe would answer. */
function fakeStripe(): Stripe {
    const stream = <T,>(items: T[]) => (async function* () { yield* items; })();
    const invoice = {
        id: "in_1", created: T0 / 1000, currency: "usd", amount_paid: 600, status_transitions: { paid_at: T0 / 1000 },
        payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_1" } }] },
        lines: { data: [{ period: { start: T0 / 1000, end: (T0 + 31 * DAY_MS) / 1000 }, parent: { type: "subscription_item_details", subscription_item_details: { proration: false } }, pricing: { price_details: { product: "prod_velai" } } }] },
    };
    return {
        prices: { retrieve: async () => ({ product: "prod_velai" }) },
        checkout: { sessions: { list: () => stream([]), listLineItems: async () => ({ data: [] }) } },
        disputes: { list: async () => ({ data: [] }) },
        charges: { list: () => stream([{ id: "ch_1", payment_intent: "pi_1", status: "succeeded", amount: 600, amount_refunded: 0, currency: "usd", disputed: false }]) },
        invoices: { list: () => stream([invoice]) },
        subscriptions: { list: () => stream([{ status: "active", cancel_at_period_end: false, cancel_at: null, items: { data: [{ price: { product: "prod_velai" }, current_period_end: (T0 + 31 * DAY_MS) / 1000 }] } }]) },
    } as unknown as Stripe;
}

describe("billing on the sealed Postgres store", { skip: !URL && "DOCSTORE_TEST_PG_URL not set" }, () => {
    let pool: Pool;
    let db: PgDocDb;
    const clean = () => pool.query(`DELETE FROM intervu."profiles" WHERE path LIKE $1`, [`profiles/${PREFIX}%`]);

    before(async () => {
        process.env.STRIPE_PRICE_ID = "price_test";
        pool = new Pool({ connectionString: URL, max: 4 });
        db = createPgDocDb(pool, deriveDocKeys("cd".repeat(32)));
        useBillingDb(db as unknown as Firestore);
        await clean();
    });
    after(async () => {
        useBillingDb();
        await clean();
        await pool.end();
    });

    it("finds the account by its Stripe customer id (the webhook's lookup, on a field the store keeps sealed) and reads it back", async () => {
        await db.collection("profiles").doc(`${PREFIX}a`).set({ display_name: "A" });
        await db.collection("profiles").doc(`${PREFIX}b`).set({ display_name: "B" });
        await writeStripeCustomerId(`${PREFIX}a`, "cus_pg_a");
        assert.equal(await findUidByStripeCustomerId("cus_pg_a"), `${PREFIX}a`);
        assert.equal(await findUidByStripeCustomerId("cus_pg_nobody"), null);
        assert.equal((await readProfileBilling(`${PREFIX}a`)).stripeCustomerId, "cus_pg_a");
        assert.equal((await readProfileBilling(`${PREFIX}b`)).stripeCustomerId, null);
    });

    it("the recompute writes access_until and auto_renew, and the Settings and /pricing reads see them", async () => {
        const uid = `${PREFIX}c`;
        await db.collection("profiles").doc(uid).set({ display_name: "C" });
        await writeStripeCustomerId(uid, "cus_pg_c");
        const until = await recomputeAccess(uid, null, fakeStripe());
        assert.equal(until, T0 + 31 * DAY_MS + RENEWAL_GRACE_MS);

        const profile = await readProfile(uid);
        assert.equal(profile?.access_until, until);
        assert.equal(profile?.auto_renew, true);
        assert.equal(profile?.display_name, "C", "the merge keeps the rest of the profile");

        const { grants, autoRenew } = await readProfileBilling(uid);
        assert.equal(autoRenew, true);
        const now = T0 + 10 * DAY_MS;
        assert.deepEqual(planSummary({ accessUntil: until, grants, now, autoRenew }), {
            status: "full", until: T0 + 31 * DAY_MS, gift: false, endsSoon: false, autoRenew: true,
        });
        assert.deepEqual(paidSummary(profile, now), { paidUntil: T0 + 31 * DAY_MS, autoRenewing: true });
    });

    it("a profile that was never billed reads as free with no auto-renew", async () => {
        const uid = `${PREFIX}d`;
        await db.collection("profiles").doc(uid).set({ display_name: "D" });
        const { grants, autoRenew } = await readProfileBilling(uid);
        assert.deepEqual(planSummary({ accessUntil: 0, grants, now: T0, autoRenew }), { status: "free" });
    });

    it("a grant is appended once per id in a real transaction", async () => {
        const uid = `${PREFIX}e`;
        await db.collection("profiles").doc(uid).set({ display_name: "E" });
        assert.equal(await appendGrantOnce(uid, { id: "g1", at: T0, days: 30 }), true);
        assert.equal(await appendGrantOnce(uid, { id: "g1", at: T0, days: 30 }), false);
        assert.deepEqual((await readProfileBilling(uid)).grants, [{ id: "g1", at: T0, days: 30 }]);
    });

    it("an account with no profile (erased) gets no billing record from a late recompute", async () => {
        assert.equal(await recomputeAccess(`${PREFIX}gone`, "cus_pg_gone", fakeStripe()), 0);
        assert.equal((await pool.query(`SELECT 1 FROM intervu."profiles" WHERE path = $1`, [`profiles/${PREFIX}gone`])).rowCount, 0);
    });
});
