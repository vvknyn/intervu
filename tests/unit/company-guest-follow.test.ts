import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveGuestEmailFollow } from "../../src/lib/follows/use-company-email-verified";

/**
 * J-COMPANY-18: a verified guest's Unfollow came back on the next load, and
 * opening any company page followed it, because the page's follow channel
 * called the contact-cookie FOLLOW on every mount. The page now only reads
 * the follow; the write is the Follow click.
 */

describe("resolveGuestEmailFollow", () => {
  const base = { followedParam: false, contact: null, clicked: null } as const;

  it("follows the server's answer for this browser's verified identity", () => {
    assert.equal(resolveGuestEmailFollow({ ...base, contact: "following" }), true);
    assert.equal(resolveGuestEmailFollow({ ...base, contact: "not-following" }), false);
  });

  it("an Unfollow stays unfollowed after a reload that still carries the verify link's ?followed=1", () => {
    assert.equal(resolveGuestEmailFollow({ followedParam: true, contact: "not-following", clicked: null }), false);
  });

  it("a shared ?followed=1 link opened by a browser with no verified identity doesn't claim a follow", () => {
    assert.equal(resolveGuestEmailFollow({ followedParam: true, contact: "no-contact", clicked: null }), false);
  });

  it("?followed=1 covers only the moment before the server answers, or a store that can't answer", () => {
    assert.equal(resolveGuestEmailFollow({ ...base, followedParam: true }), true);
    assert.equal(resolveGuestEmailFollow({ ...base, followedParam: true, contact: "unavailable" }), true);
    assert.equal(resolveGuestEmailFollow({ ...base, contact: "unavailable" }), false);
  });

  it("a click this visit wins over what the page loaded with", () => {
    assert.equal(resolveGuestEmailFollow({ ...base, contact: "following", clicked: false }), false);
    assert.equal(resolveGuestEmailFollow({ ...base, contact: "not-following", clicked: true }), true);
  });
});

describe("the company page's follow channel never writes a follow on load", () => {
  const source = readFileSync("src/lib/follows/use-company-email-verified.ts", "utf8");

  it("imports only the read-only state action, not the follow", () => {
    assert.match(source, /getContactCookieFollowStateAction/);
    assert.doesNotMatch(source, /followByContactCookieAction|unfollowByContactCookieAction/);
  });
});
