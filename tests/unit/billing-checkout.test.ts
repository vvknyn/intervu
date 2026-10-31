import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { MAX_MONTHS, MIN_MONTHS, MONTH_PRICE_USD } from "../../src/app/pricing/offer";
import { SERVER_ONLY_PROFILE_FIELDS } from "../../src/lib/billing/profile-store";
import {
    buildCheckoutParams,
    buildSubscriptionCheckoutParams,
    parseMonths,
    startCheckout,
    startPortal,
    startSubscriptionCheckout,
    subscriptionPriceMatchesOffer,
    type StartCheckoutDeps,
    type StartSubscriptionDeps,
} from "../../src/lib/billing/checkout";
import { isAutoRenewConfigured, isBillingConfigured, readSubscriptionPriceId } from "../../src/lib/billing/config";
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

describe("buildSubscriptionCheckoutParams", () => {
    const p = buildSubscriptionCheckoutParams({ uid: "uid_1", priceId: "price_m", origin: "https://velai.app", customerId: "cus_1" });
    it("is a subscription of one monthly price, tagged with the uid on the session and the subscription, naming the customer", () => {
        assert.equal(p.mode, "subscription");
        assert.deepEqual(p.line_items, [{ price: "price_m", quantity: 1 }]);
        assert.equal(p.customer, "cus_1");
        assert.equal("customer_creation" in p, false);
        assert.equal(p.client_reference_id, "uid_1");
        assert.equal(p.metadata?.velai_uid, "uid_1");
        assert.equal(p.subscription_data?.metadata?.velai_uid, "uid_1");
        assert.equal(p.success_url, "https://velai.app/billing/return?session_id={CHECKOUT_SESSION_ID}");
        assert.equal(p.cancel_url, "https://velai.app/pricing");
    });
    it("lets the buyer change nothing: no adjustable quantity, no trial", () => {
        assert.equal(JSON.stringify(p.line_items).includes("adjustable_quantity"), false);
        assert.equal(p.subscription_data?.trial_period_days, undefined);
    });
});

describe("subscriptionPriceMatchesOffer", () => {
    const ok = { unit_amount: MONTH_PRICE_USD * 100, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
    it("needs the offer's amount and currency, billed every one month", () => {
        assert.equal(subscriptionPriceMatchesOffer(ok), true);
        for (const bad of [
            { ...ok, unit_amount: ok.unit_amount + 1 },
            { ...ok, currency: "eur" },
            { ...ok, recurring: null },
            { ...ok, recurring: { interval: "year", interval_count: 1 } },
            { ...ok, recurring: { interval: "month", interval_count: 3 } },
        ]) assert.equal(subscriptionPriceMatchesOffer(bad), false);
    });
});

function fakeSubDeps(over: { price?: Partial<{ unit_amount: number | null; currency: string; recurring: { interval: string; interval_count: number } | null }>; stored?: string | null; existing?: string[]; url?: string | null } = {}) {
    const seen = { sessions: [] as Stripe.Checkout.SessionCreateParams[], created: 0, stored: [] as string[], logs: [] as string[], listed: [] as string[] };
    const deps: StartSubscriptionDeps = {
        stripe: {
            prices: { retrieve: async () => ({ unit_amount: MONTH_PRICE_USD * 100, currency: "usd", recurring: { interval: "month", interval_count: 1 }, ...over.price }) },
            customers: { create: async () => (seen.created++, { id: "cus_new" }) },
            subscriptions: { list: async (p) => (seen.listed.push(p.customer), { data: (over.existing ?? []).map((status) => ({ status })) }) },
            checkout: { sessions: { create: async (params) => (seen.sessions.push(params), { url: over.url === undefined ? "https://stripe/sub" : over.url }) } },
        },
        readCustomerId: async () => (over.stored === undefined ? null : over.stored),
        storeCustomerId: async (_u, id) => void seen.stored.push(id),
        log: (l) => seen.logs.push(l),
    };
    return { deps, seen };
}
const startSub = (deps: StartSubscriptionDeps) => startSubscriptionCheckout(deps, { uid: "uid_1", priceId: "price_m", origin: "https://velai.app" });

describe("startSubscriptionCheckout", () => {
    it("creates and stores the one customer first, checks for a live subscription on it, then opens a subscription session naming it", async () => {
        const { deps, seen } = fakeSubDeps();
        assert.deepEqual(await startSub(deps), { status: 200, body: { url: "https://stripe/sub" } });
        assert.equal(seen.created, 1);
        assert.deepEqual(seen.stored, ["cus_new"]);
        assert.deepEqual(seen.listed, ["cus_new"]);
        assert.equal(seen.sessions[0].mode, "subscription");
        assert.equal(seen.sessions[0].customer, "cus_new");
    });
    it("a price that is not the offer (amount, currency or interval) is 503 with a log and no session", async () => {
        for (const price of [{ unit_amount: MONTH_PRICE_USD * 100 + 1 }, { currency: "eur" }, { recurring: null }, { recurring: { interval: "year", interval_count: 1 } }]) {
            const { deps, seen } = fakeSubDeps({ price });
            const r = await startSub(deps);
            assert.equal(r.status, 503);
            assert.equal(seen.logs.length, 1);
            assert.equal(seen.sessions.length + seen.created, 0);
        }
    });
    it("an account with a live subscription (even one cancelling, or past due) is 409 and is sent to manage it, never charged twice", async () => {
        for (const status of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]) {
            const { deps, seen } = fakeSubDeps({ stored: "cus_old", existing: ["canceled", status] });
            const r = await startSub(deps);
            assert.equal(r.status, 409, status);
            assert.match((r.body as { error: string }).error, /Manage it in Settings/);
            assert.equal(seen.sessions.length, 0);
        }
    });
    it("old cancelled subscriptions do not block a new one", async () => {
        const { deps, seen } = fakeSubDeps({ stored: "cus_old", existing: ["canceled", "incomplete_expired"] });
        assert.equal((await startSub(deps)).status, 200);
        assert.equal(seen.sessions[0].customer, "cus_old");
    });
    it("a session with no url is 503", async () => {
        assert.equal((await startSub(fakeSubDeps({ url: null }).deps)).status, 503);
    });
});

describe("startPortal", () => {
    const deps = (stored: string | null) => {
        const seen: { customer: string; return_url: string }[] = [];
        return {
            seen,
            deps: {
                stripe: { billingPortal: { sessions: { create: async (p: { customer: string; return_url: string }) => (seen.push(p), { url: "https://billing.stripe.com/p/x" }) } } },
                readCustomerId: async () => stored,
            },
        };
    };
    it("opens the customer's portal and returns to Settings › Account", async () => {
        const { deps: d, seen } = deps("cus_1");
        assert.deepEqual(await startPortal(d, { uid: "uid_1", origin: "https://velai.app" }), { status: 200, body: { url: "https://billing.stripe.com/p/x" } });
        assert.deepEqual(seen, [{ customer: "cus_1", return_url: "https://velai.app/settings?tab=account" }]);
    });
    it("an account that never paid has nothing to manage: 404, and Stripe is not called", async () => {
        const { deps: d, seen } = deps(null);
        assert.equal((await startPortal(d, { uid: "uid_1", origin: "https://velai.app" })).status, 404);
        assert.equal(seen.length, 0);
    });
});

describe("isAutoRenewConfigured", () => {
    const base = { STRIPE_SECRET_KEY: "k", STRIPE_WEBHOOK_SECRET: "w", STRIPE_PRICE_ID: "p" };
    it("month to month needs billing and its own price; unset, it is off", () => {
        assert.equal(isAutoRenewConfigured(base), false);
        assert.equal(isAutoRenewConfigured({ ...base, STRIPE_SUBSCRIPTION_PRICE_ID: " " }), false);
        assert.equal(isAutoRenewConfigured({ ...base, STRIPE_SUBSCRIPTION_PRICE_ID: "price_m" }), true);
        assert.equal(isAutoRenewConfigured({ STRIPE_SUBSCRIPTION_PRICE_ID: "price_m" }), false);
        assert.equal(readSubscriptionPriceId({ STRIPE_SUBSCRIPTION_PRICE_ID: " price_m " }), "price_m");
        assert.throws(() => readSubscriptionPriceId({}), /STRIPE_SUBSCRIPTION_PRICE_ID/);
    });
});

describe("a Stripe call that fails while starting checkout", () => {
    const denied = () =>
        new Stripe.errors.StripePermissionError({
            message: "The provided key 'rk_live_********************************O87H' does not have the required permissions for this endpoint on account 'acct_1AbCdEfGhIj'. Having the 'rak_checkout_session_write' permission would allow this request to continue.",
            statusCode: 403,
        } as never);
    const UNAVAILABLE = { error: "Checkout is unavailable right now. Please try again later." };
    const logged = (logs: string[]) => {
        assert.equal(logs.length, 1);
        assert.match(logs[0], /^\[checkout\] failed: StripePermissionError status=403: /);
        assert.ok(logs[0].includes("rak_checkout_session_write"));
        assert.doesNotMatch(logs[0], /rk_live|O87H|acct_1AbC/);
    };

    it("prepaid: a refused session create is 503 and generic for the page, with the missing permission in the log", async () => {
        const { deps, seen } = fakeDeps();
        deps.stripe.checkout.sessions.create = async () => {
            throw denied();
        };
        assert.deepEqual(await start(deps), { status: 503, body: UNAVAILABLE });
        logged(seen.logs);
    });
    it("prepaid: a failed price read or customer create is the same 503, not a throw", async () => {
        const a = fakeDeps();
        a.deps.stripe.prices.retrieve = async () => {
            throw denied();
        };
        assert.deepEqual(await start(a.deps), { status: 503, body: UNAVAILABLE });
        logged(a.seen.logs);
        const b = fakeDeps();
        b.deps.stripe.customers.create = async () => {
            throw denied();
        };
        assert.deepEqual(await start(b.deps), { status: 503, body: UNAVAILABLE });
        logged(b.seen.logs);
    });
    it("month to month: a refused session create, subscription list or price read is the same 503 with a log", async () => {
        const a = fakeSubDeps();
        a.deps.stripe.checkout.sessions.create = async () => {
            throw denied();
        };
        assert.deepEqual(await startSub(a.deps), { status: 503, body: UNAVAILABLE });
        logged(a.seen.logs);
        const b = fakeSubDeps();
        b.deps.stripe.subscriptions.list = async () => {
            throw denied();
        };
        assert.deepEqual(await startSub(b.deps), { status: 503, body: UNAVAILABLE });
        logged(b.seen.logs);
        const c = fakeSubDeps();
        c.deps.stripe.prices.retrieve = async () => {
            throw denied();
        };
        assert.deepEqual(await startSub(c.deps), { status: 503, body: UNAVAILABLE });
        logged(c.seen.logs);
    });
    it("a store failure is also logged and answered 503; the 200 and 409 answers are unchanged", async () => {
        const { deps, seen } = fakeDeps();
        deps.readCustomerId = async () => {
            throw new Error("db down");
        };
        assert.deepEqual(await start(deps), { status: 503, body: UNAVAILABLE });
        assert.deepEqual(seen.logs, ["[checkout] failed: Error: db down"]);
        assert.equal((await start(fakeDeps().deps)).status, 200);
        assert.equal((await startSub(fakeSubDeps({ stored: "cus_old", existing: ["active"] }).deps)).status, 409);
    });
});
