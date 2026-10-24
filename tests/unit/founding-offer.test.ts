import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { foundingCheckoutUrl, paidCheckoutSessionId, pricingDescription } from "../../src/lib/billing/founding-offer";
import { mcpClientName, mcpErrorType, mcpToolFromLabel } from "../../src/lib/agent/telemetry";

const LINK = "https://buy.stripe.com/test_abc123";

describe("foundingCheckoutUrl", () => {
  it("is null when the env var is unset, empty, or not an https URL", () => {
    assert.equal(foundingCheckoutUrl(undefined, null), null);
    assert.equal(foundingCheckoutUrl("", null), null);
    assert.equal(foundingCheckoutUrl("buy.stripe.com/abc", null), null);
    assert.equal(foundingCheckoutUrl("http://buy.stripe.com/abc", null), null);
    assert.equal(foundingCheckoutUrl("javascript:alert(1)", null), null);
  });

  it("passes the link through untouched for a signed-out visitor", () => {
    assert.equal(foundingCheckoutUrl(LINK, null), LINK);
  });

  it("attaches client_reference_id and prefilled_email for a signed-in buyer", () => {
    const url = new URL(foundingCheckoutUrl(LINK, { uid: "user_01ABC-def", email: "a+b@example.com" }) ?? "");
    assert.equal(url.origin + url.pathname, LINK);
    assert.equal(url.searchParams.get("client_reference_id"), "user_01ABC-def");
    assert.equal(url.searchParams.get("prefilled_email"), "a+b@example.com");
  });

  it("drops a uid Stripe would reject rather than sending a broken link", () => {
    const url = new URL(foundingCheckoutUrl(LINK, { uid: "has space", email: "x@example.com" }) ?? "");
    assert.equal(url.searchParams.get("client_reference_id"), null);
    assert.equal(url.searchParams.get("prefilled_email"), "x@example.com");
    const tooLong = "a".repeat(201);
    assert.equal(new URL(foundingCheckoutUrl(LINK, { uid: tooLong }) ?? "").searchParams.get("client_reference_id"), null);
  });

  it("keeps query parameters the link already carries", () => {
    const url = new URL(foundingCheckoutUrl(`${LINK}?locale=en`, { uid: "u1" }) ?? "");
    assert.equal(url.searchParams.get("locale"), "en");
    assert.equal(url.searchParams.get("client_reference_id"), "u1");
  });
});

describe("paidCheckoutSessionId", () => {
  it("needs both checkout=success and a Stripe-shaped session id", () => {
    assert.equal(paidCheckoutSessionId({}), null);
    assert.equal(paidCheckoutSessionId({ checkout: "success" }), null);
    assert.equal(paidCheckoutSessionId({ session_id: "cs_test_abc" }), null);
    assert.equal(paidCheckoutSessionId({ checkout: "cancel", session_id: "cs_test_abc" }), null);
    assert.equal(paidCheckoutSessionId({ checkout: "success", session_id: "cs_test_abc" }), "cs_test_abc");
    assert.equal(paidCheckoutSessionId({ checkout: "success", session_id: "cs_live_A1b2C3" }), "cs_live_A1b2C3");
  });

  it("rejects ids that are not Stripe's shape, arrays, or oversized", () => {
    assert.equal(paidCheckoutSessionId({ checkout: "success", session_id: "not-a-stripe-id" }), null);
    assert.equal(paidCheckoutSessionId({ checkout: "success", session_id: "cs_test_<script>" }), null);
    assert.equal(paidCheckoutSessionId({ checkout: "success", session_id: ["cs_test_abc"] }), null);
    assert.equal(paidCheckoutSessionId({ checkout: ["success"], session_id: "cs_test_abc" }), null);
    assert.equal(paidCheckoutSessionId({ checkout: "success", session_id: `cs_test_${"a".repeat(121)}` }), null);
  });
});

describe("pricingDescription", () => {
  it("says seats are open only when the checkout link is configured", () => {
    const open = pricingDescription(true);
    assert.match(open, /founding seats are open now at a one-off price/);
    const soon = pricingDescription(false);
    assert.match(soon, /founding seats open soon at a one-off price/);
    assert.doesNotMatch(soon, /are open now/);
    assert.match(open, /^Velai is free to use\./);
    assert.match(soon, /^Velai is free to use\./);
    assert.doesNotMatch(open + soon, /Data API|licens/i);
  });
});

describe("MCP telemetry helpers", () => {
  it("classifies a tool payload the way toolResult marks failure", () => {
    assert.equal(mcpErrorType({ jobs: [] }), undefined);
    assert.equal(mcpErrorType({ unavailable: true }), "unavailable");
    assert.equal(mcpErrorType({ error: "job not found" }), "job_not_found");
    assert.equal(mcpErrorType({ error: "Daily company-read budget (50) exhausted." }), "daily_company_read_budget_50_exhausted");
    assert.equal(mcpErrorType({ error: "" }), undefined);
    assert.equal(mcpErrorType({ error: 42 }), undefined);
  });

  it("bounds an error slug so a long message never lands verbatim", () => {
    const slug = mcpErrorType({ error: "x".repeat(200) }) ?? "";
    assert.equal(slug.length, 48);
  });

  it("reduces a User-Agent to a bounded label", () => {
    assert.equal(mcpClientName(null), undefined);
    assert.equal(mcpClientName("   "), undefined);
    assert.equal(mcpClientName("claude-user  (Claude Desktop)"), "claude-user (Claude Desktop)");
    assert.equal((mcpClientName("a".repeat(200)) ?? "").length, 80);
  });

  it("recovers the tool name from the rate limiter's label", () => {
    assert.equal(mcpToolFromLabel("tools/call:search_jobs"), "search_jobs");
    assert.equal(mcpToolFromLabel("tools/list"), "tools/list");
    assert.equal(mcpToolFromLabel("GET"), "GET");
  });
});
