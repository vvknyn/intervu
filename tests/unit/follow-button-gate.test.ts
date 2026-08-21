import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FollowButton, decideGuestFollowClick, resolveFollowingState } from "../../src/components/companies/FollowButton";
import { visibleFollowDomains } from "../../src/lib/follows/use-follows";
import type { FollowedCompany } from "../../src/lib/follows/types";

/**
 * Class guard for "how can I follow a company when I have not shared an
 * email or logged in???" (Vivek, Aug 20): a signed-out click on Follow used
 * to flip the button to "Following ✓" and promise a weekly note off nothing
 * but a device-local guest bookmark — no server row, no address, no channel
 * that could ever send anything. "Following" may render only when a real
 * channel exists (an account, or a verified guest email).
 *
 * Both surfaces render through the same `FollowButton` — the company page
 * (`variant="outline"`/`"elite"`/`"primary"`) and the hot-table pill
 * (`variant="pill"`) — so this file proves the gate once, generically, and
 * proves the pill specifically (a case other than the company-page button)
 * to make sure "gate at the chokepoint" didn't quietly become
 * "gate on one page".
 */

const follow: FollowedCompany = {
  domain: "acme.com",
  slug: "acme",
  displayName: "Acme Corp",
  createdAt: new Date().toISOString(),
};

function render(props: Partial<React.ComponentProps<typeof FollowButton>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(FollowButton, {
      domain: "acme.com",
      slug: "acme",
      displayName: "Acme Corp",
      ...props,
    }),
  );
}

describe("decideGuestFollowClick: a signed-out click never fakes the follow", () => {
  it("not yet following -> opens the email step, never 'start following'", () => {
    assert.deepEqual(decideGuestFollowClick(false), { kind: "open-email-step" });
  });

  it("already following (a real, verified channel) -> reverses it for real", () => {
    assert.deepEqual(decideGuestFollowClick(true), { kind: "unfollow" });
  });

  it("the action type has no member that starts following locally", () => {
    // Structural proof, not just a behavioral one: exhaust every reachable
    // `kind` and confirm "following" isn't one of them.
    const kinds = [decideGuestFollowClick(false).kind, decideGuestFollowClick(true).kind];
    assert.deepEqual(new Set(kinds), new Set(["open-email-step", "unfollow"]));
  });
});

describe("visibleFollowDomains: a guest-store bookmark is not a channel", () => {
  it("signed out -> empty, even with rows present (no server row, no address)", () => {
    const map = visibleFollowDomains(false, [follow]);
    assert.equal(map.size, 0);
  });

  it("signed in -> every row counts, unchanged from before this fix", () => {
    const map = visibleFollowDomains(true, [follow]);
    assert.equal(map.get("acme.com"), follow);
  });
});

describe("resolveFollowingState: signed-in behavior is unchanged by this fix", () => {
  it("signed in + account following -> true, exactly the pre-fix formula", () => {
    assert.equal(
      resolveFollowingState({ accountFollowing: true, isSignedIn: true, emailVerified: false }),
      true,
    );
  });

  it("signed in + not account following -> false, even with a stale emailVerified=true", () => {
    // Guards the leak this fix closed: a leftover `?followed=1` from a
    // guest session must never override an account's real follow state.
    assert.equal(
      resolveFollowingState({ accountFollowing: false, isSignedIn: true, emailVerified: true }),
      false,
    );
  });

  it("signed out + verified guest channel -> true", () => {
    assert.equal(
      resolveFollowingState({ accountFollowing: false, isSignedIn: false, emailVerified: true }),
      true,
    );
  });

  it("signed out + no channel -> false (the core gate)", () => {
    assert.equal(
      resolveFollowingState({ accountFollowing: false, isSignedIn: false, emailVerified: false }),
      false,
    );
  });
});

describe("FollowButton: guest render never claims Following without a verified channel", () => {
  for (const variant of ["outline", "elite", "primary"] as const) {
    it(`variant="${variant}" (company-page button): unverified guest sees Follow, not Following`, () => {
      const html = render({ variant, emailVerified: false });
      assert.match(html, /data-following="false"/);
      assert.doesNotMatch(html, />Following/);
    });
  }

  it('variant="pill" (hot-table — a case other than the company-page button) gets the same gate', () => {
    const html = render({ variant: "pill", emailVerified: false });
    assert.match(html, /data-following="false"/);
    assert.doesNotMatch(html, />Following/);
  });
});

describe("FollowButton: variant=\"primary\" is the page's single inverted-ink action", () => {
  it('reaches Button\'s "default" variant, not "brand" (blue is for accents, never the primary CTA)', () => {
    const html = render({ variant: "primary" });
    assert.match(html, /data-variant="default"/);
    assert.doesNotMatch(html, /data-variant="brand"/);
  });

  it('variant="outline" (a case other than primary) still reaches its own Button variant, unchanged', () => {
    const html = render({ variant: "outline" });
    assert.match(html, /data-variant="outline"/);
  });
});

describe("FollowButton: a verified guest channel renders Following", () => {
  for (const variant of ["outline", "pill"] as const) {
    it(`variant="${variant}": emailVerified=true renders Following`, () => {
      const html = render({ variant, emailVerified: true });
      assert.match(html, /data-following="true"/);
      assert.match(html, />Following/);
    });
  }
});
