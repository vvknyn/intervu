import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PricingClient } from "../../src/app/pricing/pricing-client";
import { SignupGate } from "../../src/components/auth/SignupGate";
import { PERSONAL_EMAIL_HINT } from "../../src/lib/auth/auth-gate-copy";
import { PRICING_DESCRIPTION, formatPaidUntil, totalPrice } from "../../src/app/pricing/offer";

/**
 * /pricing must render at all: release 6 shipped a component that threw on
 * its first real request (a Radix Slot with two children) after typecheck,
 * lint and build had passed. This renders the client the way first paint
 * does, in every branch the props select. `renderToStaticMarkup` runs no
 * effects, so no analytics fire and no fetch is made.
 */

const PAID_UNTIL = Date.UTC(2026, 10, 22, 12);

function render(props: Parameters<typeof PricingClient>[0]): string {
  return renderToStaticMarkup(React.createElement(PricingClient, props));
}

describe("/pricing renders in every prop combination", () => {
  for (const signedIn of [false, true]) {
    for (const billingConfigured of [false, true]) {
      for (const paidUntil of [null, PAID_UNTIL]) {
        it(`signedIn=${signedIn} configured=${billingConfigured} paid=${paidUntil !== null}`, () => {
          const html = render({ signedIn, billingConfigured, paidUntil });
          assert.match(html, /data-testid="pricing-page"/);
          assert.match(html, /data-testid="pricing-card"/);
        });
      }
    }
  }
});

describe("/pricing when the paid-time read failed", () => {
  it("says it could not check and still offers the buy button", () => {
    const html = render({ signedIn: true, billingConfigured: true, paidUntil: null, paidStatusUnknown: true });
    assert.match(html, /couldn&#x27;t check your paid time/);
    assert.match(html, /data-testid="pricing-buy"/);
    assert.doesNotMatch(render({ signedIn: true, billingConfigured: true, paidUntil: null }), /pricing-paid-unknown/);
  });
});

describe("/pricing card", () => {
  it("states the price, the terms of the purchase and the privacy link", () => {
    const html = render({ signedIn: false, billingConfigured: true, paidUntil: null });
    assert.match(html, /\$6/);
    assert.match(html, /1 to 12 months/);
    assert.match(html, /no auto-renew/);
    assert.match(html, /14-day refund/);
    assert.match(html, /href="\/privacy"/);
    assert.match(html, /Always free/);
    assert.match(html, /Each month adds/);
  });

  it("configured and signed out: a month picker with 12 choices, the total, and sign-in that returns to /pricing", () => {
    const html = render({ signedIn: false, billingConfigured: true, paidUntil: null });
    assert.equal([...html.matchAll(/<option /g)].length, 12);
    assert.match(html, /Total: \$6 for 1 month/);
    assert.match(html, /data-testid="pricing-sign-in"[^>]*href="\/auth\/start\?next=\/pricing"|href="\/auth\/start\?next=\/pricing"[^>]*data-testid="pricing-sign-in"/);
    assert.doesNotMatch(html, /data-testid="pricing-buy"/);
    assert.doesNotMatch(html, /Payments open soon|Paid until/);
  });

  it("every in-app door to sign-up carries the personal-email hint WorkOS's hosted page cannot show", () => {
    const out = render({ signedIn: false, billingConfigured: true, paidUntil: null });
    assert.ok(out.includes(PERSONAL_EMAIL_HINT));
    const inn = render({ signedIn: true, billingConfigured: true, paidUntil: null });
    assert.ok(!inn.includes(PERSONAL_EMAIL_HINT));
    const gate = renderToStaticMarkup(React.createElement(SignupGate, { reason: "save", returnTo: "/jobs", originSurface: "jobs" } as never));
    assert.match(gate, /signup-gate-create/);
    assert.ok(gate.includes(PERSONAL_EMAIL_HINT));
  });

  it("configured and signed in: a Buy button, not a sign-in link", () => {
    const html = render({ signedIn: true, billingConfigured: true, paidUntil: null });
    assert.match(html, /data-testid="pricing-buy"[^>]*>Buy 1 month for \$6/);
    assert.doesNotMatch(html, /pricing-sign-in/);
  });

  it("unconfigured: says payments open soon and renders no button, picker or sign-in", () => {
    for (const signedIn of [false, true]) {
      const html = render({ signedIn, billingConfigured: false, paidUntil: null });
      assert.match(html, /Payments open soon/);
      assert.doesNotMatch(html, /pricing-buy|pricing-sign-in|<option |<select/);
    }
  });

  it("signed in with access: shows the paid-until date and offers to add months", () => {
    const html = render({ signedIn: true, billingConfigured: true, paidUntil: PAID_UNTIL });
    assert.match(html, /Paid until Nov 22, 2026/);
    assert.match(html, />Add 1 month for \$6/);
    assert.doesNotMatch(render({ signedIn: true, billingConfigured: true, paidUntil: null }), /Paid until/);
  });

  it("keeps no trace of the retired offers", () => {
    for (const billingConfigured of [false, true]) {
      const html = render({ signedIn: false, billingConfigured, paidUntil: null });
      assert.doesNotMatch(html, /founding|pledge|reserve|Data API|licens|buy\.stripe\.com/i);
    }
  });
});

describe("pricing offer helpers", () => {
  it("totals are months times the monthly price", () => {
    assert.equal(totalPrice(1), "$6");
    assert.equal(totalPrice(12), "$72");
  });
  it("paid-until is a UTC calendar date", () => {
    assert.equal(formatPaidUntil(PAID_UNTIL), "Nov 22, 2026");
  });
  it("the meta description quotes the same price and terms as the card", () => {
    assert.match(PRICING_DESCRIPTION, /\$6/);
    assert.match(PRICING_DESCRIPTION, /1 to 12 months/);
    assert.match(PRICING_DESCRIPTION, /14-day refund/);
  });
});

describe("/pricing month to month", () => {
  it("is not offered until its price is set: no toggle, no note, the prepaid picker as before", () => {
    const html = render({ signedIn: true, billingConfigured: true, paidUntil: null });
    assert.doesNotMatch(html, /pricing-mode-monthly|pricing-monthly-note|How to pay/);
    assert.match(html, /data-testid="pricing-months"/);
  });

  it("once its price is set, the card says so and offers Pay once / Month to month, prepaid first", () => {
    const html = render({ signedIn: true, billingConfigured: true, autoRenewConfigured: true, paidUntil: null });
    assert.match(html, /data-testid="pricing-monthly-note"[^>]*>Or pay month to month: \$6 each month until you cancel/);
    assert.match(html, /role="radiogroup"[^>]*aria-label="How to pay"|aria-label="How to pay"[^>]*role="radiogroup"/);
    assert.match(html, /data-testid="pricing-mode-prepaid"[^>]*>(?:<svg.*?<\/svg>)?Pay once/);
    assert.match(html, /data-testid="pricing-mode-monthly"[^>]*>(?:<svg.*?<\/svg>)?Month to month/);
    assert.equal([...html.matchAll(/<option /g)].length, 12, "the prepaid picker is what shows first");
    assert.match(html, /no auto-renew/, "the prepaid promise still reads true beside the monthly option");
  });

  it("the month-to-month note and toggle need billing: with payments not open, only 'Payments open soon'", () => {
    const html = render({ signedIn: true, billingConfigured: false, autoRenewConfigured: true, paidUntil: null });
    assert.match(html, /Payments open soon/);
    assert.doesNotMatch(html, /pricing-mode-monthly|pricing-buy/);
  });

  it("while month to month is live: the next payment date and a Settings link replace the monthly choice and 'Paid until'", () => {
    const html = render({ signedIn: true, billingConfigured: true, autoRenewConfigured: true, autoRenewing: true, paidUntil: PAID_UNTIL });
    assert.match(html, /data-testid="pricing-auto-renewing"[^>]*>Month to month is on\. Next payment /);
    assert.ok(html.includes(formatPaidUntil(PAID_UNTIL)));
    assert.match(html, /href="\/settings\?tab=account"/);
    assert.doesNotMatch(html, /pricing-mode-monthly|pricing-paid-until/);
  });

  it("month to month live but only the renewal slack left: says it is on, with no date", () => {
    const html = render({ signedIn: true, billingConfigured: true, autoRenewConfigured: true, autoRenewing: true, paidUntil: null });
    assert.match(html, /Month to month is on\./);
    assert.doesNotMatch(html, /Next payment/);
  });
});
