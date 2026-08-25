/**
 * Is this email address a test artifact rather than a person?
 *
 * Used to keep automated-test accounts out of the identity provider — both by
 * skipping them during migration and by cleaning up ones already imported.
 *
 * The rules are properties of the ADDRESS, never a list of known addresses. A
 * name list would go stale the next time a test run invents a fresh address,
 * which is precisely how these accumulated: every one of them was minted by a
 * test that had no idea it was creating a permanent identity.
 *
 * Deliberately conservative. A false positive deletes a real person's account,
 * so each rule has to be something that cannot plausibly describe a human's
 * mailbox — not merely something that looks suspicious. Burner-mail domains,
 * plus-addressing, and role addresses are all normal things real users do, and
 * none of them are matched here.
 */

/**
 * Domains reserved by the RFCs precisely so they can never be real.
 *
 * RFC 2606 reserves `example.com/.net/.org` and the `.test`, `.invalid`,
 * `.localhost` TLDs; RFC 6761 keeps them special. Mail to any of them is
 * undeliverable by definition, so an account on one cannot belong to a person
 * who could ever receive a password reset.
 */
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);
const RESERVED_TLDS = ["test", "invalid", "localhost", "example"];

/**
 * A run of 13+ digits is a millisecond epoch — `Date.now()` stamped into an
 * address to keep parallel test runs from colliding. No human types this.
 */
const MACHINE_TIMESTAMP = /\d{13,}/;

/**
 * A local part that declares itself: `qa-…`, `…-probe`, `claude-test-session`.
 *
 * Anchored to token boundaries so it matches a word, not a substring — "contest",
 * "protest" and a surname like "Testa" are left alone.
 */
const DECLARED_TEST_TOKEN = /(^|[-_.])(test|tests|qa|probe|e2e|fixture|dummy)([-_.]|$)/;

export interface TestIdentityVerdict {
  isTest: boolean;
  /** Why, so a caller can report the reason instead of a bare boolean. */
  reason?: "reserved_domain" | "machine_timestamp" | "declared_test_token";
}

export function classifyIdentity(email: string | null | undefined): TestIdentityVerdict {
  const address = (email ?? "").trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0) return { isTest: false };

  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const tld = domain.slice(domain.lastIndexOf(".") + 1);

  if (RESERVED_DOMAINS.has(domain) || RESERVED_TLDS.includes(tld)) {
    return { isTest: true, reason: "reserved_domain" };
  }
  if (MACHINE_TIMESTAMP.test(local)) {
    return { isTest: true, reason: "machine_timestamp" };
  }
  if (DECLARED_TEST_TOKEN.test(local)) {
    return { isTest: true, reason: "declared_test_token" };
  }
  return { isTest: false };
}

export function isTestIdentity(email: string | null | undefined): boolean {
  return classifyIdentity(email).isTest;
}
