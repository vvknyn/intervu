import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LandedPledgePanel } from "../../src/components/tracker/LandedPledgePanel";

/**
 * Server-renders the pay-it-forward panel in both states, the way the
 * tracker's first paint does (see pricing-render.test.ts for why: a Radix
 * Slot throw shows up here, not in typecheck or build).
 */

const STRIPE = "https://buy.stripe.com/test_pledge?client_reference_id=u1";

function render(props: Parameters<typeof LandedPledgePanel>[0]): string {
  return renderToStaticMarkup(React.createElement(LandedPledgePanel, props));
}

describe("LandedPledgePanel", () => {
  it("with a link: congratulates and offers the Stripe link, $99 suggested", () => {
    const html = render({ pledgeUrl: STRIPE, jobId: "job-1" });
    assert.match(html, /data-testid="landed-pledge"/);
    assert.match(html, /Offer in hand/);
    assert.match(html, /data-testid="landed-pledge-pay"[^>]*href="https:\/\/buy\.stripe\.com\//);
    assert.match(html, /Pay it forward/);
    assert.match(html, /\$99/);
    assert.doesNotMatch(html, /landed-pledge-tell/);
  });

  it("without a link: congratulates and asks how it went via the contact page", () => {
    const html = render({ pledgeUrl: null, jobId: null });
    assert.match(html, /Offer in hand/);
    assert.match(html, /data-testid="landed-pledge-tell"[^>]*href="\/contact\?from=\/yours"/);
    assert.doesNotMatch(html, /buy\.stripe\.com/);
    assert.doesNotMatch(html, /Pay it forward/);
  });
});
