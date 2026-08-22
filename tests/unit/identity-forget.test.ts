import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import { forgetIdentity, type ForgetIdentityDeps } from "../../src/lib/identity/forget";

class FakeQueryable implements Queryable {
  async query<R = Record<string, unknown>>(): Promise<{ rows: R[] }> {
    throw new Error("FakeQueryable: not used directly — deleteIdentity is injected");
  }
}

function baseDeps(overrides: Partial<ForgetIdentityDeps> = {}): ForgetIdentityDeps & {
  suppressions: Array<{ email: string; scope: string; reason: string }>;
  deletions: string[];
} {
  const suppressions: Array<{ email: string; scope: string; reason: string }> = [];
  const deletions: string[] = [];
  return {
    suppress: async (email, scope, reason) => {
      suppressions.push({ email, scope, reason });
    },
    deleteIdentity: async (_q, email) => {
      deletions.push(email);
      return true;
    },
    suppressions,
    deletions,
    ...overrides,
  };
}

describe("forgetIdentity — global suppression always runs first", () => {
  it("suppresses with the global 'all' scope before touching PG", async () => {
    const deps = baseDeps();
    await forgetIdentity(new FakeQueryable(), "person@example.com", deps);
    assert.deepEqual(deps.suppressions, [
      { email: "person@example.com", scope: "all", reason: "unsubscribed" },
    ]);
  });

  it("still suppresses when q is null — a PG outage must never block an unsubscribe", async () => {
    const deps = baseDeps();
    await forgetIdentity(null, "person@example.com", deps);
    assert.deepEqual(deps.suppressions, [
      { email: "person@example.com", scope: "all", reason: "unsubscribed" },
    ]);
    assert.equal(deps.deletions.length, 0, "no PG call is possible without a Queryable");
  });
});

describe("forgetIdentity — PG deletion", () => {
  it("deletes the PG identity by email when q is available", async () => {
    const deps = baseDeps();
    const q = new FakeQueryable();
    await forgetIdentity(q, "person@example.com", deps);
    assert.deepEqual(deps.deletions, ["person@example.com"]);
  });

  // Beyond-primary case: deleting an email with no PG identity behind it
  // (e.g. someone who only ever used the Firebase account, not the
  // email-follow flow) is a no-op success, not an error.
  it("resolves without throwing when no identity exists for the email", async () => {
    const deps = baseDeps({ deleteIdentity: async () => false });
    await assert.doesNotReject(() => forgetIdentity(new FakeQueryable(), "nobody@example.com", deps));
  });
});
