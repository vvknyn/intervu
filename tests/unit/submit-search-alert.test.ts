import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import { submitSearchAlert, type SubmitSearchAlertDeps } from "../../src/lib/identity/submit-search-alert";

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

function baseInput(overrides: Partial<Parameters<typeof submitSearchAlert>[1]> = {}) {
  return {
    email: "person@example.com",
    name: "Staff engineer",
    href: "/jobs?q=staff+engineer",
    redirectPath: "/jobs?q=staff+engineer",
    turnstileToken: "tok",
    requestIp: "1.2.3.4",
    ...overrides,
  };
}

function baseDeps(overrides: Partial<SubmitSearchAlertDeps> = {}): SubmitSearchAlertDeps & { sends: unknown[] } {
  const sends: unknown[] = [];
  return {
    q: new FakeQueryable(),
    verifyTurnstile: async () => ({ success: true }),
    sendVerifyEmail: async (input) => {
      sends.push(input);
    },
    baseUrl: "https://intervuhq.com",
    allowRequest: () => true,
    sends,
    ...overrides,
  };
}

describe("submitSearchAlert — validation", () => {
  it("rejects malformed email", async () => {
    const deps = baseDeps();
    const result = await submitSearchAlert(deps, baseInput({ email: "not-an-email" }));
    assert.deepEqual(result, { status: "rejected" });
    assert.equal(deps.sends.length, 0);
  });

  it("rejects invalid href", async () => {
    const deps = baseDeps();
    const result = await submitSearchAlert(deps, baseInput({ href: "/settings" }));
    assert.deepEqual(result, { status: "rejected" });
    assert.equal(deps.sends.length, 0);
  });

  it("rejects empty name", async () => {
    const deps = baseDeps();
    const result = await submitSearchAlert(deps, baseInput({ name: "   " }));
    assert.deepEqual(result, { status: "rejected" });
  });
});

describe("submitSearchAlert — PG unavailable", () => {
  it("reports unavailable when q is null", async () => {
    const deps = baseDeps({ q: null });
    const result = await submitSearchAlert(deps, baseInput());
    assert.deepEqual(result, { status: "unavailable" });
  });
});

describe("submitSearchAlert — rate limit", () => {
  it("rejects when IP rate limit denies", async () => {
    const deps = baseDeps({ allowRequest: () => false });
    const result = await submitSearchAlert(deps, baseInput());
    assert.deepEqual(result, { status: "rejected" });
    assert.equal((deps.q as FakeQueryable).calls.length, 0);
  });
});

describe("submitSearchAlert — per-address send cap", () => {
  it("returns accepted without sending at cap", async () => {
    const q = new FakeQueryable([{ rows: [{ count: 3 }] }]);
    const deps = baseDeps({ q });
    const result = await submitSearchAlert(deps, baseInput());
    assert.deepEqual(result, { status: "accepted" });
    assert.equal(deps.sends.length, 0);
  });
});

describe("submitSearchAlert — happy path", () => {
  it("creates verify_search_alert token and sends email", async () => {
    const q = new FakeQueryable([
      { rows: [{ count: 0 }] },
      { rows: [{ id: "id-1", email: "person@example.com", email_verified_at: null, contact_token: "tok-1" }] },
      { rows: [] },
    ]);
    const deps = baseDeps({ q });
    const result = await submitSearchAlert(deps, baseInput());
    assert.deepEqual(result, { status: "accepted" });
    assert.equal(deps.sends.length, 1);
    const sent = deps.sends[0] as { email: string; searchName: string; verifyUrl: string };
    assert.equal(sent.searchName, "Staff engineer");
    assert.match(sent.verifyUrl, /^https:\/\/intervuhq\.com\/api\/search-alerts\/verify\?token=[0-9a-f]{64}$/);
    assert.match(q.calls[2].text, /verify_search_alert/);
  });
});
