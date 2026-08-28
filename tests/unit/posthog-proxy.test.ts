import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POSTHOG_OPTIONS,
  POSTHOG_PROXY_PATH,
  posthogApiHost,
} from "../../src/lib/posthog-options";

/**
 * What this protects: analytics that is *configured* but never arrives.
 *
 * intervu sent posthog-js straight at `us.i.posthog.com`, which every major
 * blocklist carries. A blocked visitor makes no request, logs no error and
 * leaves no server-side trace, so the loss is unobservable from our own
 * dashboards — it reads as "we have fewer users than we thought" rather than
 * as breakage. Serving analytics from our own origin is the fix; these tests
 * exist so it cannot silently revert.
 */

test("defaults to the same-origin proxy, not a PostHog domain", () => {
  assert.equal(
    posthogApiHost("https://intervuhq.com"),
    "https://intervuhq.com/ph",
  );
});

// The regression that motivated the whole file: the old code defaulted to
// `us.i.posthog.com` when the env var was absent, so losing the var lost the
// data. Absence must now land on the proxy, never on a third party.
test("a missing override never falls back to a third-party host", () => {
  for (const missing of [undefined, null, "", "   "]) {
    const host = posthogApiHost("https://intervuhq.com", missing);
    assert.ok(
      !host.includes("posthog.com"),
      `override ${JSON.stringify(missing)} produced ${host}, which leaves our origin`,
    );
    assert.equal(host, "https://intervuhq.com/ph");
  }
});

// A different case than the one that surfaced the bug: www and preview hosts
// must proxy through whatever origin the page is actually served from, so the
// domain is never baked into the bundle.
test("follows whatever origin serves the page", () => {
  assert.equal(
    posthogApiHost("https://www.intervuhq.com"),
    "https://www.intervuhq.com/ph",
  );
  assert.equal(posthogApiHost("http://localhost:3000"), "http://localhost:3000/ph");
});

test("an explicit override still wins, and is normalised", () => {
  // Kept deliberately: debugging against PostHog directly, or a deploy with no
  // proxy in front of it, must remain possible.
  assert.equal(
    posthogApiHost("https://intervuhq.com", "https://eu.i.posthog.com/"),
    "https://eu.i.posthog.com",
  );
});

test("trailing slashes on the origin do not produce a double slash", () => {
  // posthog-js concatenates api_host + path with no normalisation, so
  // "https://intervuhq.com//ph/e/" would be a real request to a real 404.
  assert.equal(
    posthogApiHost("https://intervuhq.com/"),
    "https://intervuhq.com/ph",
  );
});

/**
 * posthog-js resolves its region from api_host and only routes assets through
 * api_host when that region is CUSTOM. A path that happened to look like a
 * PostHog domain would flip the region back to US and send the session
 * recorder to `us-assets.i.posthog.com` again — replays would vanish while
 * events kept working, which is the hardest version of this bug to notice.
 */
test("the proxy path cannot be mistaken for a PostHog region", () => {
  const REGION_PATTERNS = [
    /https:\/\/(app|us|us-assets)(\.i)?\.posthog\.com/i,
    /https:\/\/(eu|eu-assets)(\.i)?\.posthog\.com/i,
  ];
  const host = posthogApiHost("https://intervuhq.com");
  for (const pattern of REGION_PATTERNS) {
    assert.ok(!pattern.test(host), `${host} matches ${pattern} and would re-route assets off-origin`);
  }
  // The control: those patterns must actually match something, or the check
  // above passes for any string at all.
  assert.ok(REGION_PATTERNS[0].test("https://us.i.posthog.com"));
  assert.ok(REGION_PATTERNS[1].test("https://eu.i.posthog.com"));
});

test("ui_host is set, because a custom api_host breaks the derived one", () => {
  // Without this, posthog-js builds UI links by rewriting the ingestion
  // subdomain out of api_host — a no-op on our origin, leaving toolbar and
  // "view in PostHog" links pointing back at intervu.
  assert.equal(POSTHOG_OPTIONS.ui_host, "https://us.posthog.com");
});

test("the proxy path is a bare absolute path", () => {
  // It is concatenated directly onto an origin, and it is also the literal
  // prefix the Caddy rule matches on.
  assert.match(POSTHOG_PROXY_PATH, /^\/[a-z0-9-]+$/);
});

/**
 * The Caddy rule lives in the interview-os repo, so nothing here can prove it
 * exists. What this CAN do is refuse to let the path change without the change
 * being deliberate — anyone editing it has to edit this line too, and the
 * comment tells them where the other half is.
 */
test("changing the proxy path is a two-repo decision", () => {
  assert.equal(
    POSTHOG_PROXY_PATH,
    "/ph",
    "The matching rule is deploy/contabo-web/Caddyfile in interview-os. " +
      "Change both, or analytics 404s silently.",
  );

  const options = readFileSync("src/lib/posthog-options.ts", "utf8");
  assert.match(
    options,
    /interview-os/,
    "the cross-repo dependency must stay documented at the definition site",
  );
});
