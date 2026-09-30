import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PricingClient } from "../../src/app/pricing/pricing-client";

/**
 * What this protects: /pricing rendering at all.
 *
 * Release 6 (2026-09-29) shipped a version of `pricing-client.tsx` whose
 * signed-out Free column had `<Link …>Create free account</Link> {/* … *\/}`
 * inside `<Button asChild>`. `asChild` renders through a Radix Slot, which
 * calls `React.Children.only`; the stray space between the Link and the
 * comment was a second child, and the page threw on its FIRST real request
 * — after typecheck, lint, the unit suite and a production build had all
 * passed, none of which render a component. Two minutes of 500s on prod,
 * then a rollback.
 *
 * So this renders the client component server-side, the way the page's
 * first paint does, in every branch the props can select: signed in or out,
 * with and without the Stripe link, with and without a paid return. A throw
 * here is the same throw the server would make. `renderToStaticMarkup` runs
 * no effects, so no analytics fire and no storage is touched.
 */

const STRIPE = "https://buy.stripe.com/test_abc?client_reference_id=u1";

function render(props: Parameters<typeof PricingClient>[0]): string {
  return renderToStaticMarkup(React.createElement(PricingClient, props));
}

describe("/pricing renders in every prop combination", () => {
  for (const signedIn of [false, true]) {
    for (const checkoutUrl of [null, STRIPE]) {
      for (const paidSessionId of [null, "cs_test_abc123"]) {
        const label = `signedIn=${signedIn} checkout=${checkoutUrl ? "set" : "unset"} paid=${paidSessionId ? "yes" : "no"}`;
        it(label, () => {
          const html = render({ signedIn, email: null, checkoutUrl, paidSessionId });
          assert.match(html, /data-testid="pricing-page"/);
          assert.match(html, /data-testid="pricing-plan-free"/);
          assert.match(html, /data-testid="pricing-plan-pro"/);
          assert.match(html, /data-testid="pricing-plan-data-api"/);
        });
      }
    }
  }
});

describe("/pricing branches say the right thing", () => {
  it("signed out: the Free column offers an account; signed in: it points at jobs", () => {
    const out = render({ signedIn: false, email: null, checkoutUrl: null, paidSessionId: null });
    assert.match(out, /Create free account/);
    assert.match(out, /href="\/auth\/start\?mode=signup&(?:amp;)?next=\/jobs"/);
    const inn = render({ signedIn: true, email: null, checkoutUrl: null, paidSessionId: null });
    assert.match(inn, /You are on Free/);
    assert.doesNotMatch(inn, /Create free account/);
  });

  it("founding button: a Stripe link when configured, an email reservation when not", () => {
    const withLink = render({ signedIn: false, email: null, checkoutUrl: STRIPE, paidSessionId: null });
    assert.match(withLink, /data-testid="pricing-founding-cta"[^>]*href="https:\/\/buy\.stripe\.com\//);
    assert.match(withLink, /Take a founding seat/);
    assert.doesNotMatch(withLink, /pricing-founding-email/);
    const without = render({ signedIn: false, email: null, checkoutUrl: null, paidSessionId: null });
    assert.match(without, /Reserve a founding seat/);
    assert.match(without, /data-testid="pricing-founding-email"/);
    assert.doesNotMatch(without, /buy\.stripe\.com/);
    assert.doesNotMatch(without, /Founding seats open soon/);
  });

  it("the reservation form prefills a signed-in account's address", () => {
    const html = render({ signedIn: true, email: "founder@example.com", checkoutUrl: null, paidSessionId: null });
    assert.match(html, /data-testid="pricing-founding-email"[^>]*value="founder@example.com"|value="founder@example.com"[^>]*data-testid="pricing-founding-email"/);
  });

  it("the headline and the Pro badge agree with the button about whether seats are open", () => {
    // Release 7 shipped "seats are open now" over a "Founding seats open soon"
    // button while the Stripe link was unset; the page contradicted itself.
    const without = render({ signedIn: false, email: null, checkoutUrl: null, paidSessionId: null });
    assert.match(without, /Pro seats open soon at a one-off price/);
    assert.match(without, /Reservations open/);
    assert.doesNotMatch(without, /are open now/);
    const withLink = render({ signedIn: false, email: null, checkoutUrl: STRIPE, paidSessionId: null });
    assert.match(withLink, /Pro seats are open now at a one-off price/);
    assert.match(withLink, /Founding seats open</);
    assert.doesNotMatch(withLink, /open soon/);
  });

  it("the thank-you shows only on a paid return", () => {
    assert.match(render({ signedIn: true, email: null, checkoutUrl: null, paidSessionId: "cs_test_abc123" }), /You have a founding seat/);
    assert.doesNotMatch(render({ signedIn: true, email: null, checkoutUrl: null, paidSessionId: null }), /You have a founding seat/);
  });

  it("the Data API column links to the contact form from pricing", () => {
    const html = render({ signedIn: false, email: null, checkoutUrl: null, paidSessionId: null });
    assert.match(html, /data-testid="pricing-data-api-cta"[^>]*href="\/contact\?from=\/pricing"/);
  });
});
