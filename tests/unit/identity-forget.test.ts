import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import { forgetIdentity, type ForgetIdentityDeps } from "../../src/lib/identity/forget";

class FakeQueryable implements Queryable {
  async query<R = Record<string, unknown>>(): Promise<{ rows: R[] }> {
    throw new Error("FakeQueryable: not used directly — deleteIdentity/deleteTelemetry are injected");
  }
}

function baseDeps(overrides: Partial<ForgetIdentityDeps> = {}): ForgetIdentityDeps & {
  suppressions: Array<{ email: string; scope: string; reason: string }>;
  deletions: string[];
  telemetryDeletions: string[];
} {
  const suppressions: Array<{ email: string; scope: string; reason: string }> = [];
  const deletions: string[] = [];
  const telemetryDeletions: string[] = [];
  return {
    suppress: async (email, scope, reason) => {
      suppressions.push({ email, scope, reason });
    },
    deleteIdentity: async (_q, email) => {
      deletions.push(email);
      return true;
    },
    resolveWorkosUid: async () => null,
    deleteTelemetry: async (_q, userId) => {
      telemetryDeletions.push(userId);
      return 1;
    },
    suppressions,
    deletions,
    telemetryDeletions,
    ...overrides,
  };
}

describe("forgetIdentity — global suppression always runs first", () => {
  it("suppresses with the global 'all' scope before touching PG", async () => {
    const deps = baseDeps();
    await forgetIdentity(new FakeQueryable(), null, "person@example.com", deps);
    assert.deepEqual(deps.suppressions, [
      { email: "person@example.com", scope: "all", reason: "unsubscribed" },
    ]);
  });

  it("still suppresses when q is null — a PG outage must never block an unsubscribe", async () => {
    const deps = baseDeps();
    await forgetIdentity(null, null, "person@example.com", deps);
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
    await forgetIdentity(q, null, "person@example.com", deps);
    assert.deepEqual(deps.deletions, ["person@example.com"]);
  });

  // Beyond-primary case: deleting an email with no PG identity behind it
  // (e.g. someone who only ever used the Firebase account, not the
  // email-follow flow) is a no-op success, not an error.
  it("resolves without throwing when no identity exists for the email", async () => {
    const deps = baseDeps({ deleteIdentity: async () => false });
    await assert.doesNotReject(() => forgetIdentity(new FakeQueryable(), null, "nobody@example.com", deps));
  });
});

describe("forgetIdentity — telemetry ledger deletion", () => {
  it("resolves the email to a WorkOS uid and deletes exactly that uid's ledger rows", async () => {
    const ledger = new Map<string, string[]>([
      ["uid-abc", ["event-1", "event-2"]],
      ["uid-other", ["event-3"]],
    ]);
    const deps = baseDeps({
      resolveWorkosUid: async (email) => (email === "person@example.com" ? "uid-abc" : null),
      deleteTelemetry: async (_q, userId) => {
        deps.telemetryDeletions.push(userId);
        const rows = ledger.get(userId) ?? [];
        ledger.delete(userId);
        return rows.length;
      },
    });

    await forgetIdentity(null, new FakeQueryable(), "person@example.com", deps);

    assert.deepEqual(deps.telemetryDeletions, ["uid-abc"]);
    assert.equal(ledger.has("uid-abc"), false, "uid-abc's rows were deleted");
    // Generic-fix proof: a different uid's rows are untouched by this call.
    assert.deepEqual(ledger.get("uid-other"), ["event-3"]);
  });

  it("issues no delete when telemetryQ is null — no telemetry store wired", async () => {
    const deps = baseDeps({ resolveWorkosUid: async () => "uid-abc" });
    await forgetIdentity(null, null, "person@example.com", deps);
    assert.equal(deps.telemetryDeletions.length, 0);
  });

  it("issues no delete when no WorkOS account exists for the email — nothing ever wrote a ledger row under it", async () => {
    const deps = baseDeps({ resolveWorkosUid: async () => null });
    await forgetIdentity(null, new FakeQueryable(), "nobody@example.com", deps);
    assert.equal(deps.telemetryDeletions.length, 0);
  });
});
