import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyIntelGate, isCompanyIntelUnlocked } from "../../src/components/company/CompanyIntelGate";
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
        displayName: "Acme",
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
  it("renders data-unlocked=false with blur and follow CTA when no channel exists", () => {
    const html = renderLockedGate();
    assert.match(html, /data-testid="company-intel-gate"/);
    assert.match(html, /data-unlocked="false"/);
    assert.match(html, /blur-\[6px\]/);
    assert.match(html, /Follow to unlock hiring intel/);
    assert.match(html, /data-testid="follow-company"/);
  });

  it("names what's locked instead of a bare wash: a described frame with a followers-only row", () => {
    const html = renderLockedGate();
    // The frame says what's behind it by name, not just "hiring intel".
    assert.match(html, /funding, tech stack, and news for Acme/);
    // A dashed lock row, not another solid block — distinguishes "there is
    // more here" from the surrounding blurred content.
    assert.match(html, /border-dashed/);
    assert.match(html, /Followers only/);
  });

  it("reserves a height floor so the lock card can't overflow a wrapper whose blurred children are shorter than the card itself", () => {
    const html = renderLockedGate();
    assert.match(html, /min-h-\[320px\]/);
  });
});

/** A second gate instance with the rail's overrides — no button, a narrower
 *  description, and its own testid, so it can share the page with the
 *  main-column gate above without colliding on `data-testid`. */
function renderRailGate(): string {
  return renderToStaticMarkup(
    React.createElement(
      CompanyFollowChannelProvider,
      {
        domain: "acme.com",
        displayName: "Acme",
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
    assert.match(html, /border-dashed/);
    assert.doesNotMatch(html, /data-testid="follow-company"/);
  });

  it("a custom description overrides the default copy entirely, not just appends to it", () => {
    const html = renderRailGate();
    assert.doesNotMatch(html, /funding, tech stack, and news/);
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

  it("header idleLabel states the unlock bargain explicitly", () => {
    const source = readFileSync(CO_PAGE, "utf8");
    assert.match(source, /idleLabel="Follow — unlock hiring intel"/);
  });
});
