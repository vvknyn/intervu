import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, paymentRows, paymentStanding } from "../../src/lib/billing/billing-view";
import type { PaymentRecord } from "../../src/lib/billing/recompute";

const rec = (over: Partial<PaymentRecord>): PaymentRecord => ({
    kind: "prepaid", paidMs: 1, amount: 600, refunded: 0, currency: "usd", months: 1, receiptUrl: null, ...over,
});

describe("paymentRows", () => {
    it("labels what each payment bought and lists newest first", () => {
        const rows = paymentRows([
            rec({ paidMs: 10, months: 3, amount: 1800 }),
            rec({ paidMs: 30, kind: "monthly", months: null }),
            rec({ paidMs: 20, months: 1 }),
        ]);
        assert.deepEqual(rows.map((r) => [r.paidMs, r.label]), [[30, "Month to month"], [20, "1 month"], [10, "3 months"]]);
    });
    it("a fully refunded purchase (0 months standing) is still a 1-or-more-months line, not '0 months'", () => {
        assert.equal(paymentRows([rec({ months: 0, refunded: 600 })])[0].label, "1 month");
    });
    it("nothing paid is an empty list, not a placeholder row", () => {
        assert.deepEqual(paymentRows([]), []);
    });
});

describe("paymentStanding", () => {
    it("paid, partly refunded, refunded", () => {
        assert.equal(paymentStanding({ amount: 600, refunded: 0 }), "paid");
        assert.equal(paymentStanding({ amount: 600, refunded: 200 }), "partly_refunded");
        assert.equal(paymentStanding({ amount: 600, refunded: 600 }), "refunded");
    });
});

describe("formatMoney", () => {
    it("shows minor units as the currency's amount", () => {
        assert.equal(formatMoney(600, "usd"), "$6.00");
        assert.equal(formatMoney(1250, "USD"), "$12.50");
        assert.equal(formatMoney(600, "cad"), "CA$6.00");
    });
    it("an unknown currency code still shows an amount", () => {
        assert.match(formatMoney(600, "zz"), /6\.00/);
    });
});
