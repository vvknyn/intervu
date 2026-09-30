import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import {
  followByContactCookie,
  getContactCookieFollowState,
  unfollowByContactCookie,
  type ContactCookieFollowDeps,
} from "../../src/actions/email-follow";

class FakeQueryable implements Queryable {
  calls: Array<{ text: string; params: unknown[] }> = [];
  private responses: Array<{ rows: unknown[] }>;

  constructor(responses: Array<{ rows: unknown[] }> = []) {
    this.responses = [...responses];
  }

  async query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
    this.calls.push({ text, params });
    const next = this.responses.shift();
    if (!next) throw new Error(`FakeQueryable: no scripted response for call #${this.calls.length}: ${text}`);
    return next as { rows: R[] };
  }
}

function depsWithToken(q: Queryable | null, token: string | null): ContactCookieFollowDeps {
  return { q, getContactToken: async () => token };
}

describe("followByContactCookie — PG unavailable", () => {
  it("returns unavailable and never reads the cookie", async () => {
    let cookieReads = 0;
    const deps: ContactCookieFollowDeps = {
      q: null,
      getContactToken: async () => {
        cookieReads += 1;
        return "tok-1";
      },
    };
    const result = await followByContactCookie(deps, { companyDomain: "acme.com", displayName: "Acme" });
    assert.deepEqual(result, { status: "unavailable" });
    assert.equal(cookieReads, 0, "honest absence — no cookie lookup when PG is off");
  });
});

describe("followByContactCookie — no cookie present", () => {
  it("returns no-contact without querying the store", async () => {
    const q = new FakeQueryable();
    const result = await followByContactCookie(depsWithToken(q, null), {
      companyDomain: "acme.com",
      displayName: "Acme",
    });
    assert.deepEqual(result, { status: "no-contact" });
    assert.equal(q.calls.length, 0);
  });
});

describe("followByContactCookie — stale/unknown token (beyond-primary case)", () => {
  it("returns no-contact when the cookie token matches no identity", async () => {
    const q = new FakeQueryable([{ rows: [] }]); // getIdentityByContactToken finds nothing
    const result = await followByContactCookie(depsWithToken(q, "stale-token"), {
      companyDomain: "acme.com",
      displayName: "Acme",
    });
    assert.deepEqual(result, { status: "no-contact" });
    assert.equal(q.calls.length, 1, "only the identity lookup runs — no follow write for a dead token");
  });
});

describe("followByContactCookie — happy path", () => {
  it("adds the follow for the identity behind the cookie", async () => {
    const q = new FakeQueryable([
      { rows: [{ id: "id-1", email: "a@b.co", email_verified_at: "2026-08-19T00:00:00Z", contact_token: "tok-1" }] },
      { rows: [] }, // addEmailFollow's INSERT
    ]);
    const result = await followByContactCookie(depsWithToken(q, "tok-1"), {
      companyDomain: "acme.com",
      displayName: "Acme",
    });
    assert.deepEqual(result, { status: "followed" });
    assert.match(q.calls[1].text, /INSERT INTO intervu\.email_follows/);
    assert.deepEqual(q.calls[1].params, ["id-1", "acme.com", "Acme"]);
  });
});

describe("unfollowByContactCookie — PG unavailable", () => {
  it("returns unavailable", async () => {
    const result = await unfollowByContactCookie(depsWithToken(null, "tok-1"), { companyDomain: "acme.com" });
    assert.deepEqual(result, { status: "unavailable" });
  });
});

describe("unfollowByContactCookie — stale token", () => {
  it("returns no-contact for a token matching no identity", async () => {
    const q = new FakeQueryable([{ rows: [] }]);
    const result = await unfollowByContactCookie(depsWithToken(q, "stale-token"), { companyDomain: "acme.com" });
    assert.deepEqual(result, { status: "no-contact" });
  });
});

describe("unfollowByContactCookie — happy path", () => {
  it("clears the follow for the identity behind the cookie", async () => {
    const q = new FakeQueryable([
      { rows: [{ id: "id-1", email: "a@b.co", email_verified_at: "2026-08-19T00:00:00Z", contact_token: "tok-1" }] },
      { rows: [] }, // removeEmailFollow's UPDATE
    ]);
    const result = await unfollowByContactCookie(depsWithToken(q, "tok-1"), { companyDomain: "acme.com" });
    assert.deepEqual(result, { status: "unfollowed" });
    assert.match(q.calls[1].text, /unsubscribed_at\s*=\s*now\(\)/i);
    assert.deepEqual(q.calls[1].params, ["id-1", "acme.com"]);
  });
});

describe("getContactCookieFollowState — what a company page asks on load (J-COMPANY-18)", () => {
  const identityRow = { id: "id-1", email: "a@b.co", email_verified_at: "2026-08-19T00:00:00Z", contact_token: "tok-1" };

  it("returns unavailable without reading the cookie when PG is off", async () => {
    let cookieReads = 0;
    const deps: ContactCookieFollowDeps = {
      q: null,
      getContactToken: async () => {
        cookieReads += 1;
        return "tok-1";
      },
    };
    assert.deepEqual(await getContactCookieFollowState(deps, { companyDomain: "acme.com" }), { status: "unavailable" });
    assert.equal(cookieReads, 0);
  });

  it("returns no-contact for no cookie, or a cookie that names no identity", async () => {
    const none = new FakeQueryable();
    assert.deepEqual(await getContactCookieFollowState(depsWithToken(none, null), { companyDomain: "acme.com" }), {
      status: "no-contact",
    });
    assert.equal(none.calls.length, 0);
    const stale = new FakeQueryable([{ rows: [] }]);
    assert.deepEqual(await getContactCookieFollowState(depsWithToken(stale, "stale"), { companyDomain: "acme.com" }), {
      status: "no-contact",
    });
  });

  it("reports following only for a row that isn't unsubscribed, and never writes", async () => {
    const following = new FakeQueryable([{ rows: [identityRow] }, { rows: [{ "?column?": 1 }] }]);
    assert.deepEqual(await getContactCookieFollowState(depsWithToken(following, "tok-1"), { companyDomain: "acme.com" }), {
      status: "following",
    });
    assert.match(following.calls[1].text, /^\s*SELECT[\s\S]*email_follows[\s\S]*unsubscribed_at IS NULL/);
    assert.deepEqual(following.calls[1].params, ["id-1", "acme.com"]);

    const unfollowed = new FakeQueryable([{ rows: [identityRow] }, { rows: [] }]);
    assert.deepEqual(await getContactCookieFollowState(depsWithToken(unfollowed, "tok-1"), { companyDomain: "acme.com" }), {
      status: "not-following",
    });

    for (const call of [...following.calls, ...unfollowed.calls]) {
      assert.doesNotMatch(call.text, /\b(INSERT|UPDATE|DELETE)\b/i, "opening a page must not write a follow");
    }
  });
});
