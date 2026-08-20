import { test } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import {
  normalizeEmail,
  upsertIdentityForEmail,
  countRecentVerifyTokens,
  createVerifyToken,
  consumeVerifyToken,
  addEmailFollow,
  removeEmailFollow,
  getIdentityByContactToken,
  listEmailFollowRecipients,
  deleteIdentityByEmail,
} from "../../src/lib/identity/store";

class FakeQueryable implements Queryable {
  calls: Array<{ text: string; params: unknown[] }> = [];
  private responses: Array<{ rows: unknown[] }>;

  constructor(responses: Array<{ rows: unknown[] }>) {
    this.responses = [...responses];
  }

  async query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
    this.calls.push({ text, params });
    const next = this.responses.shift();
    if (!next) throw new Error(`FakeQueryable: no scripted response for call #${this.calls.length}: ${text}`);
    return next as { rows: R[] };
  }
}

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  A@B.co "), "a@b.co");
  assert.equal(normalizeEmail("already@normal.com"), "already@normal.com");
});

test("upsertIdentityForEmail sends the normalized email and maps the returned row", async () => {
  const fake = new FakeQueryable([
    { rows: [{ id: "id-1", email: "a@b.co", email_verified_at: null, contact_token: "tok-1" }] },
  ]);
  const row = await upsertIdentityForEmail(fake, "  A@B.co ");
  assert.deepEqual(row, { id: "id-1", email: "a@b.co", emailVerifiedAt: null, contactToken: "tok-1" });
  assert.ok(fake.calls[0].params.includes("a@b.co"), "normalized email must be a bound param");
});

test("countRecentVerifyTokens returns a numeric count for the normalized email", async () => {
  const fake = new FakeQueryable([{ rows: [{ count: 2 }] }]);
  const count = await countRecentVerifyTokens(fake, "A@B.co", 24);
  assert.equal(count, 2);
  assert.ok(fake.calls[0].params.includes("a@b.co"));
});

test("createVerifyToken returns a raw hex token and never binds it as a param — only its sha256 digest", async () => {
  const fake = new FakeQueryable([{ rows: [] }]);
  const raw = await createVerifyToken(fake, { identityId: "id-1", redirectPath: "/co/acme", requestIp: "1.2.3.4" });
  assert.match(raw, /^[0-9a-f]{64}$/, "raw token must be 64-char hex (32 random bytes)");
  const boundParams = fake.calls[0].params;
  assert.ok(!boundParams.includes(raw), "raw token must never be bound as a query param");
  const hashParam = boundParams.find((p) => Buffer.isBuffer(p)) as Buffer | undefined;
  assert.ok(hashParam, "a Buffer (sha256 digest) must be bound in place of the raw token");
  const { createHash } = await import("node:crypto");
  assert.ok(hashParam!.equals(createHash("sha256").update(raw).digest()));
});

test("consumeVerifyToken: SQL enforces single-use semantics (consumed_at IS NULL, expires_at > now())", async () => {
  const fake = new FakeQueryable([
    { rows: [{ identity_id: "id-1", redirect_path: "/co/acme" }] },
    { rows: [{ id: "id-1", email: "a@b.co", contact_token: "tok-1" }] },
  ]);
  const result = await consumeVerifyToken(fake, "a".repeat(64));
  assert.deepEqual(result, { identityId: "id-1", email: "a@b.co", redirectPath: "/co/acme", contactToken: "tok-1" });
  const consumeSql = fake.calls[0].text;
  assert.match(consumeSql, /consumed_at IS NULL/);
  assert.match(consumeSql, /expires_at > now\(\)/);
});

test("consumeVerifyToken returns null when the token is missing, expired, or already consumed", async () => {
  const fake = new FakeQueryable([{ rows: [] }]);
  const result = await consumeVerifyToken(fake, "b".repeat(64));
  assert.equal(result, null);
});

test("addEmailFollow upserts and clears unsubscribed_at on re-follow", async () => {
  const fake = new FakeQueryable([{ rows: [] }]);
  await addEmailFollow(fake, { identityId: "id-1", companyDomain: "acme.com", displayName: "Acme" });
  assert.match(fake.calls[0].text, /unsubscribed_at\s*=\s*NULL/i);
  assert.deepEqual(fake.calls[0].params, ["id-1", "acme.com", "Acme"]);
});

test("removeEmailFollow sets unsubscribed_at for the given identity+domain", async () => {
  const fake = new FakeQueryable([{ rows: [] }]);
  await removeEmailFollow(fake, "id-1", "acme.com");
  assert.match(fake.calls[0].text, /unsubscribed_at\s*=\s*now\(\)/i);
  assert.deepEqual(fake.calls[0].params, ["id-1", "acme.com"]);
});

test("getIdentityByContactToken maps the row, and returns null when no match", async () => {
  const found = new FakeQueryable([
    { rows: [{ id: "id-1", email: "a@b.co", email_verified_at: "2026-08-01T00:00:00Z", contact_token: "tok-1" }] },
  ]);
  assert.deepEqual(await getIdentityByContactToken(found, "tok-1"), {
    id: "id-1",
    email: "a@b.co",
    emailVerifiedAt: "2026-08-01T00:00:00Z",
    contactToken: "tok-1",
  });

  const missing = new FakeQueryable([{ rows: [] }]);
  assert.equal(await getIdentityByContactToken(missing, "no-such-token"), null);
});

test("listEmailFollowRecipients filters to verified identities and active follows, grouped per identity", async () => {
  const fake = new FakeQueryable([
    {
      rows: [
        { identity_id: "id-1", email: "a@b.co", company_domain: "acme.com", display_name: "Acme" },
        { identity_id: "id-1", email: "a@b.co", company_domain: "beta.com", display_name: "Beta" },
        { identity_id: "id-2", email: "c@d.co", company_domain: "gamma.com", display_name: "Gamma" },
      ],
    },
  ]);
  const recipients = await listEmailFollowRecipients(fake);
  assert.match(fake.calls[0].text, /email_verified_at IS NOT NULL/);
  assert.match(fake.calls[0].text, /unsubscribed_at IS NULL/);
  assert.deepEqual(recipients, [
    {
      identityId: "id-1",
      email: "a@b.co",
      follows: [
        { domain: "acme.com", displayName: "Acme" },
        { domain: "beta.com", displayName: "Beta" },
      ],
    },
    { identityId: "id-2", email: "c@d.co", follows: [{ domain: "gamma.com", displayName: "Gamma" }] },
  ]);
});

test("deleteIdentityByEmail deletes by normalized email and returns true on a match", async () => {
  const fake = new FakeQueryable([{ rows: [{ id: "id-1" }] }]);
  const deleted = await deleteIdentityByEmail(fake, "  A@B.co ");
  assert.equal(deleted, true);
  assert.ok(fake.calls[0].params.includes("a@b.co"));
});

test("deleteIdentityByEmail returns false when nothing matched (beyond-primary case)", async () => {
  const fake = new FakeQueryable([{ rows: [] }]);
  const deleted = await deleteIdentityByEmail(fake, "nobody@nowhere.co");
  assert.equal(deleted, false);
});
