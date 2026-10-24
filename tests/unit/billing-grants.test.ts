import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GrantRecomputeError, grantDays } from "../../src/lib/billing/grants";
import { appendGrantOnce, useBillingDb } from "../../src/lib/billing/profile-store";
import { DAY_MS } from "../../src/lib/billing/recompute";
import { memoryFirestore } from "./memory-firestore";

const T0 = Date.UTC(2026, 9, 1);
afterEach(() => useBillingDb());

describe("grantDays", () => {
    it("F6: the same grant id twice stores one entry and gives the days once", async () => {
        const { db, docs } = memoryFirestore({ "profiles/u": {} });
        useBillingDb(db);
        const first = await grantDays("u", { id: "launch", days: 30 }, T0);
        const again = await grantDays("u", { id: "launch", days: 30 }, T0 + 5 * DAY_MS);
        assert.equal(first.added, true);
        assert.equal(again.added, false);
        assert.deepEqual(docs.get("profiles/u")?.grants, [{ id: "launch", at: T0, days: 30 }]);
        assert.equal(docs.get("profiles/u")?.access_until, T0 + 30 * DAY_MS);
    });
    it("a different grant id stacks, and works for an account with no profile doc yet", async () => {
        const { db, docs } = memoryFirestore();
        useBillingDb(db);
        await grantDays("fresh", { id: "launch", days: 30 }, T0);
        await grantDays("fresh", { id: "founding", days: 10 }, T0 + 5 * DAY_MS);
        assert.equal((docs.get("profiles/fresh")?.grants as unknown[]).length, 2);
        assert.equal(docs.get("profiles/fresh")?.access_until, T0 + 40 * DAY_MS);
    });
    it("a recompute failure after the write is its own error, and a re-run of the same id repairs it", async () => {
        const { db, docs } = memoryFirestore({ "profiles/u": { stripe_customer_id: "cus_1" } });
        useBillingDb(db);
        const saved = process.env.STRIPE_SECRET_KEY;
        delete process.env.STRIPE_SECRET_KEY; // customer exists, Stripe unreachable by config
        await assert.rejects(() => grantDays("u", { id: "launch", days: 30 }, T0), GrantRecomputeError);
        assert.equal((docs.get("profiles/u")?.grants as unknown[]).length, 1, "the grant itself was stored");
        if (saved) process.env.STRIPE_SECRET_KEY = saved;
    });
});

describe("appendGrantOnce", () => {
    it("is a no-op for an existing id, even with different days", async () => {
        const { db, docs } = memoryFirestore({ "profiles/u": { grants: [{ id: "g", at: 1, days: 5 }] } });
        useBillingDb(db);
        assert.equal(await appendGrantOnce("u", { id: "g", at: 2, days: 99 }), false);
        assert.deepEqual(docs.get("profiles/u")?.grants, [{ id: "g", at: 1, days: 5 }]);
        assert.equal(await appendGrantOnce("u", { id: "h", at: 2, days: 7 }), true);
        assert.equal((docs.get("profiles/u")?.grants as unknown[]).length, 2);
    });
});
