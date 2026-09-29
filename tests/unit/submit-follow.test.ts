import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import { submitFollowEmail, type SubmitFollowDeps } from "../../src/lib/identity/submit-follow";
import { turnstileRejectMessage } from "../../src/lib/shield/turnstile";

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

function baseInput(overrides: Partial<Parameters<typeof submitFollowEmail>[1]> = {}) {
  return {
    email: "person@example.com",
    companyDomain: "acme.com",
    displayName: "Acme",
    redirectPath: "/co/acme",
    turnstileToken: "tok",
    requestIp: "1.2.3.4",
    ...overrides,
  };
}

function baseDeps(overrides: Partial<SubmitFollowDeps> = {}): SubmitFollowDeps & { sends: unknown[] } {
  const sends: unknown[] = [];
  return {
    q: new FakeQueryable(),
    verifyTurnstile: async () => ({ success: true }),
    sendVerifyEmail: async (input) => {
      sends.push(input);
    },
    baseUrl: "https://intervuhq.com",
    sends,
    ...overrides,
  };
}

describe("submitFollowEmail — email validation", () => {
  it("rejects a malformed email before touching PG or Turnstile", async () => {
    const deps = baseDeps();
    const result = await submitFollowEmail(deps, baseInput({ email: "not-an-email" }));
    assert.deepEqual(result, { status: "rejected" });
    assert.equal(deps.sends.length, 0);
    assert.equal((deps.q as FakeQueryable).calls.length, 0);
  });
});

describe("submitFollowEmail — PG unavailable", () => {
  it("reports unavailable rather than a fake accept when q is null", async () => {
    let turnstileCalled = false;
    const deps = baseDeps({
      q: null,
      verifyTurnstile: async () => {
        turnstileCalled = true;
        return { success: true };
      },
    });
    const result = await submitFollowEmail(deps, baseInput());
    assert.deepEqual(result, { status: "unavailable" });
    assert.equal(deps.sends.length, 0);
    assert.equal(turnstileCalled, false, "PG absence is checked before spending a Turnstile call");
  });
});

describe("submitFollowEmail — Turnstile", () => {
  it("rejects on a failed Turnstile check without touching the store", async () => {
    const deps = baseDeps({ verifyTurnstile: async () => ({ success: false, reason: "missing-token" }) });
    const result = await submitFollowEmail(deps, baseInput());
    assert.deepEqual(result, { status: "rejected", message: turnstileRejectMessage("missing-token") });
    assert.equal(deps.sends.length, 0);
    assert.equal((deps.q as FakeQueryable).calls.length, 0);
  });
});

describe("submitFollowEmail — per-address send cap", () => {
  it("returns accepted without sending once the address has 3 recent verify tokens", async () => {
    const q = new FakeQueryable([{ rows: [{ count: 3 }] }]);
    const deps = baseDeps({ q });
    const result = await submitFollowEmail(deps, baseInput());
    assert.deepEqual(result, { status: "accepted" });
    assert.equal(deps.sends.length, 0, "capped address must not receive another send");
    assert.equal(q.calls.length, 1, "only the count query runs — no upsert, no token insert");
  });

  it("still sends at 2 recent tokens (below the cap)", async () => {
    const q = new FakeQueryable([
      { rows: [{ count: 2 }] },
      { rows: [{ id: "id-1", email: "person@example.com", email_verified_at: null, contact_token: "tok-1" }] },
      { rows: [] },
    ]);
    const deps = baseDeps({ q });
    const result = await submitFollowEmail(deps, baseInput());
    assert.deepEqual(result, { status: "accepted" });
    assert.equal(deps.sends.length, 1);
  });
});

describe("submitFollowEmail — happy path", () => {
  it("upserts, creates a token, sends the verify email with a well-formed url", async () => {
    const q = new FakeQueryable([
      { rows: [{ count: 0 }] },
      { rows: [{ id: "id-1", email: "person@example.com", email_verified_at: null, contact_token: "tok-1" }] },
      { rows: [] },
    ]);
    const deps = baseDeps({ q });
    const result = await submitFollowEmail(deps, baseInput());
    assert.deepEqual(result, { status: "accepted" });
    assert.equal(deps.sends.length, 1);
    const sent = deps.sends[0] as { email: string; companyName: string; verifyUrl: string };
    assert.equal(sent.email, "person@example.com");
    assert.equal(sent.companyName, "Acme");
    assert.match(sent.verifyUrl, /^https:\/\/intervuhq\.com\/api\/follow-email\/verify\?token=[0-9a-f]{64}$/);
  });

  // Enumeration guard, beyond the primary "new address" flow: an address
  // that is already verified gets the exact same response shape.
  it("responds identically for an already-verified identity as for a new one", async () => {
    const qNew = new FakeQueryable([
      { rows: [{ count: 0 }] },
      { rows: [{ id: "id-1", email: "new@example.com", email_verified_at: null, contact_token: "tok-1" }] },
      { rows: [] },
    ]);
    const qExisting = new FakeQueryable([
      { rows: [{ count: 0 }] },
      {
        rows: [
          { id: "id-2", email: "existing@example.com", email_verified_at: "2026-08-01T00:00:00Z", contact_token: "tok-2" },
        ],
      },
      { rows: [] },
    ]);

    const resultNew = await submitFollowEmail(baseDeps({ q: qNew }), baseInput({ email: "new@example.com" }));
    const resultExisting = await submitFollowEmail(
      baseDeps({ q: qExisting }),
      baseInput({ email: "existing@example.com" }),
    );
    assert.deepEqual(resultNew, { status: "accepted" });
    assert.deepEqual(resultExisting, { status: "accepted" });
    assert.deepEqual(resultNew, resultExisting);
  });
});
