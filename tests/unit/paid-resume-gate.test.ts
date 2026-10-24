import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PAYMENT_REQUIRED } from "../../src/lib/billing/access";
import { refuseUnpaid, whenPaid } from "../../src/lib/resume/when-paid";
import { fetchBaseResumeDoc } from "../../src/lib/resume/base-resume";
import { paywallRefusal } from "../../src/lib/agent/paywall";
import { extensionMeBody } from "../../src/lib/extension-me";
import { isPaymentRequired } from "../../src/lib/resume/payment-required";
import { writeDailyPicksSetting } from "../../src/lib/daily-picks/account";

/**
 * P2: the stored résumé (read, write, AI over it) is the paid month. One check
 * (`hasPaidAccess`) reaches every site through these shapes; each is tested
 * with a paid and an unpaid account, and with two accounts so the answer is
 * per user.
 */
process.env.NEXT_PUBLIC_SITE_URL = "https://velai.app";
const paidSet = new Set(["u-paid", "u-paid-2"]);
const isPaid = async (uid: string) => paidSet.has(uid);

describe("whenPaid / refuseUnpaid", () => {
    it("reads for a paid account and answers none (without reading) for an unpaid one", async () => {
        let reads = 0;
        const read = async () => (++reads, "the résumé");
        assert.equal(await whenPaid("u-paid", read, "none", isPaid), "the résumé");
        assert.equal(await whenPaid("u-paid-2", read, "none", isPaid), "the résumé");
        assert.equal(await whenPaid("u-free", read, "none", isPaid), "none");
        assert.equal(reads, 2, "the unpaid read never ran");
    });

    it("refuses an unpaid write with the typed code and lets a paid one go", async () => {
        assert.equal((await refuseUnpaid("u-free", isPaid))?.code, PAYMENT_REQUIRED);
        assert.equal(await refuseUnpaid("u-paid", isPaid), null);
        assert.equal(await refuseUnpaid("u-paid-2", isPaid), null);
    });

    it("lets a profile-store failure surface instead of reading as unpaid", async () => {
        await assert.rejects(whenPaid("u", async () => 1, 0, async () => { throw new Error("store down"); }), /store down/);
    });
});

describe("the one reader of the stored résumé", () => {
    it("reports no résumé at all to an unpaid account, whoever it is", async () => {
        for (const uid of ["u-free", "u-other-free"]) {
            assert.deepEqual(await fetchBaseResumeDoc(uid, isPaid), { base: { source: "none" }, updatedAt: null });
        }
    });
});

describe("the connected-AI paywall", () => {
    it("refuses an unpaid account on a tool that declares needsPaid, with the copy and the pricing link", async () => {
        const refused = await paywallRefusal(true, "u-free", isPaid);
        assert.equal(refused?.code, PAYMENT_REQUIRED);
        assert.equal(refused!.error.endsWith("https://velai.app/pricing"), true);
    });

    it("lets a paid account through, and every account through a free tool", async () => {
        assert.equal(await paywallRefusal(true, "u-paid", isPaid), null);
        assert.equal(await paywallRefusal(undefined, "u-free", isPaid), null);
        assert.equal(await paywallRefusal(false, "u-free", isPaid), null);
    });
});

describe("/api/extension/me", () => {
    const stored = { data: { fake: 1 }, text: "t", updatedAt: "2026-10-01" } as never;
    const prefs = { data: { remote: true } } as never;

    it("hands a paid account its résumé and says paid", () => {
        const { status, body } = extensionMeBody(stored, prefs);
        assert.equal(status, 200);
        assert.equal(body.paid, true);
        assert.deepEqual(body.resume, { data: { fake: 1 }, text: "t", updatedAt: "2026-10-01" });
        assert.deepEqual(body.preferences, { remote: true });
    });

    it("gives an unpaid account no résumé, still its preferences, and says not paid", () => {
        const { status, body } = extensionMeBody({ paywalled: true } as never, prefs);
        assert.equal(status, 200);
        assert.equal(body.paid, false);
        assert.equal(body.resume, null);
        assert.deepEqual(body.preferences, { remote: true });
    });

    it("fails closed on a read error: an error status, never paid, never a résumé", () => {
        const { status, body } = extensionMeBody({ error: "boom" } as never, prefs);
        assert.equal(status, 503);
        assert.notEqual(body.paid, true);
        assert.equal("resume" in body && body.resume, false);
    });
});

describe("what the browser does with a refusal", () => {
    it("recognises the typed code and nothing else", () => {
        assert.equal(isPaymentRequired({ code: PAYMENT_REQUIRED }), true);
        assert.equal(isPaymentRequired({ code: "other" }), false);
        assert.equal(isPaymentRequired({}), false);
        assert.equal(isPaymentRequired(null), false);
    });
});

describe("daily picks", () => {
    it("can't be turned on by an unpaid account, but the address check still comes first", async () => {
        const refused = await writeDailyPicksSetting("u-free", "a@example.com", true, isPaid);
        assert.equal("code" in refused && refused.code, PAYMENT_REQUIRED);
        const noAddress = await writeDailyPicksSetting("u-free", null, true, isPaid);
        assert.ok("error" in noAddress && !("code" in noAddress));
    });
});
