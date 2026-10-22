import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import { consumeAndFollow, CONTACT_COOKIE_NAME } from "../../src/lib/identity/contact-cookie";
import { GET } from "../../src/app/api/follow-email/verify/route";

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

describe("consumeAndFollow — invalid/expired token", () => {
  it("returns null and never touches email_follows", async () => {
    const q = new FakeQueryable([{ rows: [] }]); // consumeVerifyToken's UPDATE finds no matching row
    const result = await consumeAndFollow(q, "a".repeat(64), { companyDomain: "acme.com", displayName: "Acme" });
    assert.equal(result, null);
    assert.equal(q.calls.length, 1, "only the token UPDATE runs — no identity or follow write");
  });
});

describe("consumeAndFollow — success with a follow payload", () => {
  it("consumes the token and adds the follow", async () => {
    const q = new FakeQueryable([
      { rows: [{ identity_id: "id-1", redirect_path: "/co/acme" }] },
      { rows: [{ id: "id-1", email: "a@b.co", email_verified_at: "2026-08-19T00:00:00Z", contact_token: "tok-1" }] },
      { rows: [] }, // addEmailFollow's INSERT
    ]);
    const result = await consumeAndFollow(q, "a".repeat(64), { companyDomain: "acme.com", displayName: "Acme" });
    assert.deepEqual(result, { redirectPath: "/co/acme", contactToken: "tok-1", email: "a@b.co" });
    assert.equal(q.calls.length, 3);
    assert.match(q.calls[2].text, /INSERT INTO intervu\.email_follows/);
    assert.deepEqual(q.calls[2].params, ["id-1", "acme.com", "Acme"]);
  });
});

describe("consumeAndFollow — success WITHOUT a follow payload (beyond-primary case)", () => {
  it("still consumes the token and returns redirectPath/contactToken, but adds no follow", async () => {
    const q = new FakeQueryable([
      { rows: [{ identity_id: "id-1", redirect_path: "/co/acme" }] },
      { rows: [{ id: "id-1", email: "a@b.co", email_verified_at: "2026-08-19T00:00:00Z", contact_token: "tok-1" }] },
    ]);
    const result = await consumeAndFollow(q, "a".repeat(64), null);
    assert.deepEqual(result, { redirectPath: "/co/acme", contactToken: "tok-1", email: "a@b.co" });
    assert.equal(q.calls.length, 2, "the primitive is not company-bound — no email_follows write happens");
  });
});

describe("GET /api/follow-email/verify — honest failure paths (no request-scope cookie write)", () => {
  it("redirects to the failure path when no token is present", async () => {
    const res = await GET(new Request("http://x/api/follow-email/verify"));
    assert.equal(res.status, 307);
    // Location must be app-relative, not resolved against request.url — behind
    // the reverse proxy that origin is the container's own bind address, not
    // the public host (see src/lib/http/relative-redirect.ts).
    assert.equal(res.headers.get("location"), "/jobs?followed=0");
  });

  it("redirects to the failure path when INTERVU_PG_URL is unset (this test process never sets it)", async () => {
    const res = await GET(new Request("http://x/api/follow-email/verify?token=abc&domain=acme.com&name=Acme"));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "/jobs?followed=0");
  });
});

describe("CONTACT_COOKIE_NAME", () => {
  it("is a stable, non-empty cookie name", () => {
    assert.equal(typeof CONTACT_COOKIE_NAME, "string");
    assert.ok(CONTACT_COOKIE_NAME.length > 0);
  });
});
