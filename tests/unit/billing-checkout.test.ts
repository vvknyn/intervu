import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type Stripe from "stripe";
import { MAX_MONTHS, MIN_MONTHS, MONTH_PRICE_USD } from "../../src/app/pricing/offer";
import { SERVER_ONLY_PROFILE_FIELDS } from "../../src/lib/billing/profile-store";
import { buildCheckoutParams, parseMonths, startCheckout, type StartCheckoutDeps } from "../../src/lib/billing/checkout";
import { isBillingConfigured } from "../../src/lib/billing/config";
import { decideReturn } from "../../src/lib/billing/return";
import { parseGrantArgs } from "../../scripts/grant-access-days";

const base = { uid: "uid_1", months: 3, priceId: "price_x", origin: "https://velai.app", customerId: "cus_1" };

describe("buildCheckoutParams", () => {
    it("is a one-time payment of adjustable 1-12 months tagged with the uid, always naming the customer", () => {
        const p = buildCheckoutParams(base);
        assert.equal(p.mode, "payment");
        assert.deepEqual(p.line_items, [
            { price: "price_x", quantity: 3, adjustable_quantity: { enabled: true, minimum: MIN_MONTHS, maximum: MAX_MONTHS } },
        ]);
        assert.equal(p.customer, "cus_1");
        assert.equal("customer_creation" in p, false);
        assert.equal(p.client_reference_id, "uid_1");
        assert.equal(p.metadata?.velai_uid, "uid_1");
        assert.equal(p.payment_intent_data?.metadata?.velai_uid, "uid_1");
        assert.equal(p.success_url, "https://velai.app/billing/return?session_id={CHECKOUT_SESSION_ID}");
        assert.equal(p.cancel_url, "https://velai.app/pricing");
        assert.deepEqual(p.managed_payments, { enabled: false });
    });
});

function fakeDeps(over: { unit_amount?: number | null; currency?: string; stored?: string | null; url?: string | null } = {}) {
    const seen = { create: [] as { params: Stripe.CustomerCreateParams; key: string }[], sessions: [] as Stripe.Checkout.SessionCreateParams[], stored: [] as string[], logs: [] as string[], prices: [] as string[] };
    const deps: StartCheckoutDeps = {
        stripe: {
            prices: {
                retrieve: async (id) => (seen.prices.push(id), { unit_amount: over.unit_amount === undefined ? MONTH_PRICE_USD * 100 : over.unit_amount, currency: over.currency ?? "usd" }),
            },
            customers: { create: async (params, o) => (seen.create.push({ params, key: o.idempotencyKey }), { id: "cus_new" }) },
            checkout: { sessions: { create: async (p) => (seen.sessions.push(p), { url: over.url === undefined ? "https://stripe/s" : over.url }) } },
        },
        readCustomerId: async () => (over.stored === undefined ? null : over.stored),
        storeCustomerId: async (_u, id) => void seen.stored.push(id),
        log: (l) => seen.logs.push(l),
    };
    return { deps, seen };
}
const start = (deps: StartCheckoutDeps, uid = "uid_1") => startCheckout(deps, { uid, months: 2, priceId: "price_x", origin: "https://velai.app" });

describe("startCheckout", () => {
    it("F2: creates the customer first with the idempotency key and uid metadata, stores it, then passes it to the session", async () => {
        const { deps, seen } = fakeDeps();
        const r = await start(deps);
        assert.deepEqual(r, { status: 200, body: { url: "https://stripe/s" } });
        assert.deepEqual(seen.create, [{ params: { metadata: { velai_uid: "uid_1" } }, key: "velai-customer-uid_1" }]);
        assert.deepEqual(seen.stored, ["cus_new"]);
        assert.equal(seen.sessions[0].customer, "cus_new");
        assert.equal("customer_creation" in seen.sessions[0], false);
    });
    it("the key is per account", async () => {
        const { deps, seen } = fakeDeps();
        await start(deps, "uid_other");
        assert.equal(seen.create[0].key, "velai-customer-uid_other");
    });
    it("reuses a stored customer without creating one", async () => {
        const { deps, seen } = fakeDeps({ stored: "cus_old" });
        await start(deps);
        assert.equal(seen.create.length, 0);
        assert.deepEqual(seen.stored, []);
        assert.equal(seen.sessions[0].customer, "cus_old");
    });
    it("displayed price must equal charged price: a different amount or currency is 503 with a log and no session or customer", async () => {
        for (const over of [{ unit_amount: MONTH_PRICE_USD * 100 + 1 }, { unit_amount: null }, { currency: "eur" }]) {
            const { deps, seen } = fakeDeps(over);
            const r = await start(deps);
            assert.equal(r.status, 503);
            assert.match((r.body as { error: string }).error, /unavailable/);
            assert.equal(seen.logs.length, 1);
            assert.equal(seen.sessions.length + seen.create.length, 0);
            assert.deepEqual(seen.prices, ["price_x"]);
        }
    });
    it("a session with no url is 503", async () => {
        assert.equal((await start(fakeDeps({ url: null }).deps)).status, 503);
    });
});

describe("offer bounds", () => {
    it("the terms page renders the price and bounds from offer.ts, not literals", () => {
        const src = readFileSync("src/app/terms/page.tsx", "utf8");
        assert.match(src, /PRO_MONTHLY_PRICE/);
        assert.match(src, /MAX_MONTHS/);
        assert.doesNotMatch(src, new RegExp(`\\$${MONTH_PRICE_USD}\\b`));
    });
});

describe("firestore.rules", () => {
    it("names every server-only profile field", () => {
        const rules = readFileSync("firestore.rules", "utf8");
        for (const f of SERVER_ONLY_PROFILE_FIELDS) assert.ok(rules.includes(`'${f}'`) || rules.includes(`"${f}"`), f);
    });
});

describe("parseMonths", () => {
    it("defaults to 1 and accepts only whole numbers 1-12", () => {
        assert.equal(parseMonths(undefined), 1);
        assert.equal(parseMonths(12), 12);
        for (const bad of [0, 13, 1.5, "3", null, NaN]) assert.equal(parseMonths(bad), null);
    });
});

describe("isBillingConfigured", () => {
    it("needs the key, the webhook secret and the price", () => {
        const all = { STRIPE_SECRET_KEY: "k", STRIPE_WEBHOOK_SECRET: "w", STRIPE_PRICE_ID: "p" };
        assert.equal(isBillingConfigured(all), true);
        assert.equal(isBillingConfigured({}), false);
        for (const k of Object.keys(all)) assert.equal(isBillingConfigured({ ...all, [k]: " " }), false);
    });
});

describe("decideReturn", () => {
    const s = (over = {}) => ({ client_reference_id: "uid_1", payment_status: "paid", status: "complete", ...over });
    it("refuses a session that belongs to another account, even a paid one", () => {
        assert.equal(decideReturn(s({ client_reference_id: "uid_2" }), "uid_1"), "not_yours");
        assert.equal(decideReturn(s({ client_reference_id: null }), "uid_1"), "not_yours");
    });
    it("separates paid, still-processing and not-completed", () => {
        assert.equal(decideReturn(s(), "uid_1"), "paid");
        assert.equal(decideReturn(s({ payment_status: "unpaid" }), "uid_1"), "pending");
        assert.equal(decideReturn(s({ payment_status: "unpaid", status: "expired" }), "uid_1"), "failed");
    });
});

describe("grant script", () => {
    it("requires --days, --grant-id and the audience", () => {
        assert.deepEqual(parseGrantArgs(["--days", "30", "--all-accounts", "--grant-id", "launch-1"]), { days: 30, grantId: "launch-1", apply: false });
        assert.equal((parseGrantArgs(["--days", "30", "--all-accounts", "--grant-id", "g", "--apply"]) as { apply: boolean }).apply, true);
        const ok = ["--days", "30", "--all-accounts", "--grant-id", "g"];
        for (const bad of [[], ["--days", "30"], ["--all-accounts"], ok.slice(0, 3), ["--days", "0", "--all-accounts", "--grant-id", "g"], ["--days", "367", "--all-accounts", "--grant-id", "g"], [...ok.slice(0, 4), "bad id!"]]) {
            assert.ok("error" in (parseGrantArgs(bad) as object));
        }
    });
});
