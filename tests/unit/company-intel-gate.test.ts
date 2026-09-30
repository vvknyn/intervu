import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyIntelGate, isCompanyIntelUnlocked, shouldGateRenderNothing } from "../../src/components/company/CompanyIntelGate";
import { CompanyFollowChannelProvider } from "../../src/components/companies/CompanyFollowChannelProvider";

const CO_PAGE = join(__dirname, "..", "..", "src", "app", "co", "[slug]", "page.tsx");

describe("isCompanyIntelUnlocked: mirrors production Follow semantics", () => {
  it("signed in + account following -> unlocked", () => {
    assert.equal(
      isCompanyIntelUnlocked({ accountFollowing: true, isSignedIn: true, emailVerified: false }),
      true,
    );
  });

  it("signed in + not account following -> locked, even with stale guest emailVerified", () => {
    assert.equal(
      isCompanyIntelUnlocked({ accountFollowing: false, isSignedIn: true, emailVerified: true }),
      false,
    );
  });

  it("signed out + verified guest channel -> unlocked", () => {
    assert.equal(
      isCompanyIntelUnlocked({ accountFollowing: false, isSignedIn: false, emailVerified: true }),
      true,
    );
  });

  it("signed out + no channel -> locked (guest localStorage bookmark does not unlock)", () => {
    assert.equal(
      isCompanyIntelUnlocked({ accountFollowing: false, isSignedIn: false, emailVerified: false }),
      false,
    );
  });
});

/** The locked-gate fixture both tests below render — a follow channel with
 *  no verified/account state, wrapping a gate around an arbitrary child. */
function renderLockedGate(): string {
  return renderToStaticMarkup(
    React.createElement(
      CompanyFollowChannelProvider,
      {
        domain: "acme.com",
        children: React.createElement(
          CompanyIntelGate,
          {
            domain: "acme.com",
            slug: "acme",
            displayName: "Acme",
            children: React.createElement("p", null, "Hidden intel"),
          },
        ),
      },
    ),
  );
}

describe("CompanyIntelGate: locked overlay for unsigned-out visitors", () => {
  it("renders data-unlocked=false with a hidden child and follow CTA when no channel exists", () => {
    const html = renderLockedGate();
    assert.match(html, /data-testid="company-intel-gate"/);
    assert.match(html, /data-unlocked="false"/);
    assert.match(html, /pointer-events-none select-none/);
    assert.match(html, /Follow this company to see its hiring history/);
    assert.match(html, /data-testid="follow-company"/);
  });

  it("names what's locked instead of a bare wash: a described frame with a followers-only row", () => {
    const html = renderLockedGate();
    // The frame says what's behind it by name, not just "hiring intel".
    assert.match(html, /funding, tech stack, and news for Acme/);
    // A bordered panel card, distinguished from the surrounding hidden content.
    assert.match(html, /rounded-panel border border-border bg-surface/);
    assert.match(html, /Followers only/);
  });

  it("reserves a height floor so the lock card can't overflow a wrapper whose hidden children are shorter than the card itself", () => {
    const html = renderLockedGate();
    assert.match(html, /min-h-80/);
  });
});

/** A second gate instance exercising the description/showFollowButton/testId
 *  overrides directly — independent of which call site (if any) uses them. */
function renderRailGate(): string {
  return renderToStaticMarkup(
    React.createElement(
      CompanyFollowChannelProvider,
      {
        domain: "acme.com",
        children: React.createElement(
          CompanyIntelGate,
          {
            domain: "acme.com",
            slug: "acme",
            displayName: "Acme",
            testId: "company-intel-gate-record",
            description: "The hiring record and list health for Acme — visible once you follow.",
            showFollowButton: false,
            children: React.createElement("p", null, "The hiring record"),
          },
        ),
      },
    ),
  );
}

describe("CompanyIntelGate: rail overrides (testId, description, showFollowButton)", () => {
  it("a distinct testId lets a second gate instance share the page without colliding", () => {
    const html = renderRailGate();
    assert.match(html, /data-testid="company-intel-gate-record"/);
    assert.ok(!html.includes('data-testid="company-intel-gate"'), "must not also carry the default testid");
  });

  it("showFollowButton=false keeps the named, veiled frame but drops the CTA — the Follow card sits above it", () => {
    const html = renderRailGate();
    assert.match(html, /The hiring record and list health for Acme/);
    assert.match(html, /Followers only/);
    assert.match(html, /rounded-panel border border-border bg-surface/);
    assert.doesNotMatch(html, /data-testid="follow-company"/);
  });

  it("a custom description overrides the default copy entirely, not just appends to it", () => {
    const html = renderRailGate();
    assert.doesNotMatch(html, /funding, tech stack, and news/);
  });
});

/** A locked gate with an explicit `fallback` — parameterized so both the
 *  `null` and default cases render through the same fixture. Signed-out
 *  with no follow channel, so `unlocked` is false without any mocking (same
 *  fixture shape as `renderLockedGate` above). */
function renderLockedGateWithFallback(fallback: React.ReactNode | undefined): string {
  return renderToStaticMarkup(
    React.createElement(
      CompanyFollowChannelProvider,
      {
        domain: "acme.com",
        children: React.createElement(
          CompanyIntelGate,
          {
            domain: "acme.com",
            slug: "acme",
            displayName: "Acme",
            fallback,
            children: React.createElement("p", null, "Hidden intel"),
          },
        ),
      },
    ),
  );
}

describe("CompanyIntelGate: fallback prop", () => {
  it("locked + fallback={null} renders nothing", () => {
    const html = renderLockedGateWithFallback(null);
    assert.equal(html, "");
  });

  it("locked + default (fallback omitted) renders the built-in lock card", () => {
    const html = renderLockedGateWithFallback(undefined);
    assert.match(html, /data-testid="company-intel-gate"/);
    assert.match(html, /Follow this company to see its hiring history/);
    assert.match(html, /rounded-panel border border-border bg-surface/);
  });

  // `unlocked` comes from account/session state that only resolves in a
  // browser effect (see useFollows/useCompanyEmailVerifiedChannel) — not
  // reachable from a static SSR render without mocking those hooks, which
  // is why `isCompanyIntelUnlocked`/`resolveFollowingState` are tested as
  // pure functions elsewhere in this codebase rather than through a
  // hook-mocked render. `shouldGateRenderNothing` is that same seam for
  // this prop: it takes `unlocked` as a plain boolean, so "unlocked
  // regardless of fallback" is provable directly, without mocks.
  it("unlocked renders children regardless of fallback", () => {
    assert.equal(shouldGateRenderNothing(true, null), false);
    assert.equal(shouldGateRenderNothing(true, undefined), false);
    assert.equal(shouldGateRenderNothing(true, React.createElement("p", null, "custom")), false);
  });
});

describe("/co/[slug]: a non-follower sees exactly one lock card", () => {
  it("exactly one of the page's CompanyIntelGate instances can render a card", () => {
    const source = readFileSync(CO_PAGE, "utf8");
    const gateInstances = source.match(/<CompanyIntelGate\b/g) ?? [];
    const suppressedInstances = source.match(/fallback=\{null\}/g) ?? [];
    assert.equal(gateInstances.length, 2, "expected exactly two CompanyIntelGate instances on the page");
    assert.equal(
      gateInstances.length - suppressedInstances.length,
      1,
      "exactly one CompanyIntelGate instance may omit fallback={null} and so render a card for a non-follower",
    );
  });
});

describe("/co/[slug]: secondary intel is gated behind follow", () => {
  it("CompanyIntelGate wraps the secondary block contents inside company-secondary", () => {
    const source = readFileSync(CO_PAGE, "utf8");
    const secondaryIndex = source.indexOf('data-testid="company-secondary"');
    const teaserIndex = source.indexOf("<CompanyChangeEventTeaser");
    const gateOpenIndex = source.indexOf("<CompanyIntelGate");
    const gateCloseIndex = source.indexOf("</CompanyIntelGate>");
    const intelIndex = source.indexOf("<CompanyIntelligenceGrid");
    assert.ok(secondaryIndex !== -1, "company-secondary wrapper missing");
    assert.ok(teaserIndex !== -1, "CompanyChangeEventTeaser missing");
    assert.ok(gateOpenIndex !== -1, "CompanyIntelGate missing");
    assert.ok(gateCloseIndex !== -1, "CompanyIntelGate close tag missing");
    assert.ok(secondaryIndex < teaserIndex, "teaser must live inside company-secondary");
    assert.ok(teaserIndex < gateOpenIndex, "teaser must render outside the intel gate");
    assert.ok(gateOpenIndex < intelIndex && intelIndex < gateCloseIndex, "intel grid must be gated");
  });

  it("header idleLabel states the primary CTA", () => {
    const source = readFileSync(CO_PAGE, "utf8");
    assert.match(source, /idleLabel="Follow this company"/);
  });
});
