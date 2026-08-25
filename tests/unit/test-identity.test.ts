import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIdentity, isTestIdentity } from "../../src/lib/auth/test-identity";

/**
 * This predicate decides whether an account gets DELETED, so the cases that
 * matter most are the ones it must refuse to match. A false positive removes a
 * real person's login; a false negative just leaves some litter behind.
 */
test("real people are never classified as test artifacts", () => {
  // Every one of these is an actual migrated user. They are here so that
  // tightening the rules later cannot quietly start matching them.
  const real = [
    "jv@lightsource.ai",
    "soni.akshit@bcg.com",
    "david.walsh@material.security",
    "br5306@g.rit.edu",
    "jonathanplacidopro@gmail.com",
    "sanskrutikhot2002@gmail.com",
    "whitney@oliveandcompany.com",
    "ricky@hiring.cafe",
    "vivek.nar87@gmail.com",
    "stephen@sorath.co.uk",
    // A disposable-mail domain is a normal thing a real person uses to sign
    // up. It is not evidence of a test.
    "strict289@nobinbox.com",
    // Plus-addressing is normal too, and is NOT a test marker.
    "someone+newsletter@protonmail.com",
    // Role addresses belong to people.
    "dev@thesubspace.io",
    "info@redoracle.com",
    // The gated-UI test login is a REAL account that is actively used; the
    // rules must not reach it.
    "vvk@intervu.cc",
    "vvk-admin@intervu.cc",
    "shobha@intervu.cc",
  ];
  for (const email of real) {
    assert.equal(isTestIdentity(email), false, `must not match: ${email}`);
  }
});

test("substrings are not tokens — a word boundary is required", () => {
  // The near-misses that a naive `includes("test")` would destroy.
  assert.equal(isTestIdentity("contest@gmail.com"), false);
  assert.equal(isTestIdentity("protest@gmail.com"), false);
  assert.equal(isTestIdentity("testa@gmail.com"), false, "a surname");
  assert.equal(isTestIdentity("greatest.hits@gmail.com"), false);
  assert.equal(isTestIdentity("probert@gmail.com"), false);
  assert.equal(isTestIdentity("qatar.office@gmail.com"), false);

  // ...but a delimited token is matched.
  assert.equal(classifyIdentity("claude-test-session@intervu.cc").reason, "declared_test_token");
  assert.equal(classifyIdentity("qa-authprobe@intervu.cc").reason, "declared_test_token");
  assert.equal(classifyIdentity("nightly_e2e@intervu.cc").reason, "declared_test_token");
  assert.equal(classifyIdentity("test@intervu.cc").reason, "declared_test_token");
});

test("RFC-reserved domains can never be a real mailbox", () => {
  for (const email of [
    "kri@example.com",
    "vvk@example.com",
    "anyone@example.org",
    "anyone@example.net",
    "anyone@host.invalid",
    "anyone@box.test",
    "anyone@localhost",
  ]) {
    assert.equal(classifyIdentity(email).reason, "reserved_domain", email);
  }

  // A real domain that merely CONTAINS the word is untouched.
  assert.equal(isTestIdentity("hi@example.company"), false);
  assert.equal(isTestIdentity("hi@myexample.com"), false);
});

test("a millisecond epoch in the local part is a machine, not a person", () => {
  assert.equal(
    classifyIdentity("probeuser1787056190256@intervu.cc").reason,
    "machine_timestamp",
  );
  assert.equal(
    classifyIdentity("e2emobiledesc1787056428517@intervu.cc").reason,
    "machine_timestamp",
  );

  // Shorter digit runs are things people really use — a birth year, a phone
  // fragment, a handle. 12 digits is below the epoch-millisecond threshold.
  assert.equal(isTestIdentity("sanskrutikhot2002@gmail.com"), false);
  assert.equal(isTestIdentity("jay5426in@gmail.com"), false);
  assert.equal(isTestIdentity("user123456789012@gmail.com"), false, "12 digits");
});

test("malformed input is not a test account", () => {
  // Refusing to classify is the safe answer: nothing gets deleted on the
  // strength of an unparseable address.
  for (const bad of ["", "   ", null, undefined, "no-at-sign", "@nolocal.com"]) {
    assert.equal(isTestIdentity(bad as string), false, JSON.stringify(bad));
  }
});

test("classification is case- and whitespace-insensitive", () => {
  assert.equal(isTestIdentity("  KRI@EXAMPLE.COM "), true);
  assert.equal(isTestIdentity("Claude-Test-Session@Intervu.cc"), true);
});
