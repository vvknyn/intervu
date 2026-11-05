import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { describeStripeError, isPermissionDenied } from "../../src/lib/billing/stripe-error";

describe("describeStripeError", () => {
    const permission = new Stripe.errors.StripePermissionError({
        message: "The provided key 'rk_live_********************************XyZ9' does not have the required permissions for this endpoint on account 'acct_1AbCdEfGhIj'. Having the 'rak_invoice_read' permission would allow this request to continue.",
        statusCode: 403,
    } as never);

    it("keeps the class, status and the permission Stripe names, and blanks the key and the account id", () => {
        const line = describeStripeError(permission);
        assert.match(line, /^StripePermissionError status=403: /);
        assert.ok(line.includes("'rak_invoice_read'"));
        assert.ok(line.includes("'[key]'") && line.includes("'[id]'"), line);
        assert.doesNotMatch(line, /rk_live|XyZ9|acct_1AbC/);
    });
    it("blanks customer and charge ids wherever they appear", () => {
        const line = describeStripeError(new Error("No such customer: 'cus_Qx12Ab34Cd'; charge ch_3Pabc123def"));
        assert.equal(line, "Error: No such customer: '[id]'; charge [id]");
    });
    it("is bounded and handles a non-Error", () => {
        assert.ok(describeStripeError(new Error("x".repeat(5000))).length < 450);
        assert.equal(describeStripeError("boom"), "unknown error");
    });
});

describe("isPermissionDenied", () => {
    it("is true for Stripe's 403 refusal only", () => {
        assert.equal(isPermissionDenied(new Stripe.errors.StripePermissionError({ message: "x", statusCode: 403 } as never)), true);
        assert.equal(isPermissionDenied(new Stripe.errors.StripeAuthenticationError({ message: "x", statusCode: 401 } as never)), false);
        assert.equal(isPermissionDenied(new Error("x")), false);
        assert.equal(isPermissionDenied(undefined), false);
    });
});
