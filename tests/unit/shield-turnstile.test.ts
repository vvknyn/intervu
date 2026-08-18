import { test } from "node:test";
import assert from "node:assert/strict";
import { decideTurnstileResult, verifyTurnstile } from "../../src/lib/shield/turnstile";

test("decideTurnstileResult: unconfigured (no secret key) is inert regardless of token or response", () => {
  assert.deepEqual(decideTurnstileResult(false, "any-token", null), { status: "not-configured" });
  assert.deepEqual(decideTurnstileResult(false, undefined, { success: true }), { status: "not-configured" });
  assert.deepEqual(decideTurnstileResult(false, "", { success: false }), { status: "not-configured" });
});

test("decideTurnstileResult: configured + missing/empty token is rejected, never passed", () => {
  assert.deepEqual(decideTurnstileResult(true, undefined, null), { status: "reject", reason: "missing-token" });
  assert.deepEqual(decideTurnstileResult(true, null, null), { status: "reject", reason: "missing-token" });
  assert.deepEqual(decideTurnstileResult(true, "   ", null), { status: "reject", reason: "missing-token" });
});

test("decideTurnstileResult: configured + a failed verify request (no response reached) is rejected", () => {
  assert.deepEqual(decideTurnstileResult(true, "some-token", null), { status: "reject", reason: "verify-request-failed" });
});

test("decideTurnstileResult: configured + Cloudflare says success:false is rejected, with the error codes as reason", () => {
  const result = decideTurnstileResult(true, "bad-token", { success: false, "error-codes": ["invalid-input-response"] });
  assert.deepEqual(result, { status: "reject", reason: "invalid-input-response" });
});

test("decideTurnstileResult: configured + success:false with no error codes still rejects with a fallback reason", () => {
  assert.deepEqual(decideTurnstileResult(true, "bad-token", { success: false }), { status: "reject", reason: "invalid-token" });
});

test("decideTurnstileResult: configured + Cloudflare says success:true passes", () => {
  assert.deepEqual(decideTurnstileResult(true, "good-token", { success: true }), { status: "pass" });
});

test("verifyTurnstile: unconfigured is inert without ever calling fetch", async (t) => {
  const original = process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  const fetchCalls: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (...args: unknown[]) => {
    fetchCalls.push(args);
    throw new Error("fetch should never be called when unconfigured");
  });
  try {
    const result = await verifyTurnstile("any-token");
    assert.deepEqual(result, { status: "not-configured" });
    assert.equal(fetchCalls.length, 0);
  } finally {
    if (original === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = original;
  }
});

test("verifyTurnstile: configured + a bad token is rejected (fetch stubbed to Cloudflare's failure shape)", async (t) => {
  const original = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  t.mock.method(globalThis, "fetch", async () => ({
    json: async () => ({ success: false, "error-codes": ["timeout-or-duplicate"] }),
  }));
  try {
    const result = await verifyTurnstile("bad-token");
    assert.deepEqual(result, { status: "reject", reason: "timeout-or-duplicate" });
  } finally {
    if (original === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = original;
  }
});

test("verifyTurnstile: configured + a missing token is rejected without ever calling fetch", async (t) => {
  const original = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  const fetchCalls: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (...args: unknown[]) => {
    fetchCalls.push(args);
    return { json: async () => ({ success: true }) };
  });
  try {
    const result = await verifyTurnstile(undefined);
    assert.deepEqual(result, { status: "reject", reason: "missing-token" });
    assert.equal(fetchCalls.length, 0);
  } finally {
    if (original === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = original;
  }
});

test("verifyTurnstile: configured + a good token passes (fetch stubbed to Cloudflare's success shape)", async (t) => {
  const original = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = new URLSearchParams(init.body as string);
    assert.equal(body.get("secret"), "test-secret");
    assert.equal(body.get("response"), "good-token");
    return { json: async () => ({ success: true }) };
  });
  try {
    const result = await verifyTurnstile("good-token");
    assert.deepEqual(result, { status: "pass" });
  } finally {
    if (original === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = original;
  }
});

test("verifyTurnstile: configured + fetch throwing (network failure) is rejected, never a silent pass", async (t) => {
  const original = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  try {
    const result = await verifyTurnstile("some-token");
    assert.deepEqual(result, { status: "reject", reason: "verify-request-failed" });
  } finally {
    if (original === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = original;
  }
});
