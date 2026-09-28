import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOGS_ENDPOINT,
  SERVICE_NAME,
  buildOtlpPayload,
  levelPasses,
  logServer,
  requestErrorRecord,
  resolveLogsConfig,
  scrubMessage,
  takeSlot,
} from "../../src/lib/observability/posthog-logs";

const ON = { POSTHOG_LOGS_ENABLED: "1", NEXT_PUBLIC_POSTHOG_KEY: "phc_test", NODE_ENV: "production" };

test("no-op unless enabled AND a token is present", () => {
  assert.equal(resolveLogsConfig({}), null);
  assert.equal(resolveLogsConfig({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" }), null);
  assert.equal(resolveLogsConfig({ POSTHOG_LOGS_ENABLED: "1" }), null);
  assert.equal(resolveLogsConfig({ POSTHOG_LOGS_ENABLED: "0", NEXT_PUBLIC_POSTHOG_KEY: "phc_test" }), null);
});

test("defaults: US OTLP endpoint, warn floor, only explicit info opts in", () => {
  const cfg = resolveLogsConfig(ON);
  assert.equal(cfg?.endpoint, DEFAULT_LOGS_ENDPOINT);
  assert.equal(cfg?.minLevel, "warn");
  assert.equal(resolveLogsConfig({ ...ON, POSTHOG_LOGS_LEVEL: "info" })?.minLevel, "info");
  assert.equal(resolveLogsConfig({ ...ON, POSTHOG_LOGS_LEVEL: "debug" })?.minLevel, "warn");
  assert.equal(resolveLogsConfig({ ...ON, POSTHOG_LOGS_ENDPOINT: "https://eu.i.posthog.com/i/v1/logs" })?.endpoint,
    "https://eu.i.posthog.com/i/v1/logs");
});

test("level gate: info is dropped at the warn floor, warn/error pass; info passes when opted in", () => {
  assert.equal(levelPasses("info", "warn"), false);
  assert.equal(levelPasses("warn", "warn"), true);
  assert.equal(levelPasses("error", "warn"), true);
  assert.equal(levelPasses("info", "info"), true);
});

test("budget: allows the window's quota, drops the rest, reopens next window", () => {
  let state = { windowStart: 0, used: 0 };
  let allowed = 0;
  for (let i = 0; i < 100; i++) {
    const r = takeSlot(state, 1_000);
    state = r.state;
    if (r.allowed) allowed++;
  }
  assert.equal(allowed, 60);
  assert.equal(takeSlot(state, 1_000 + 60_000).allowed, true);
});

test("scrubMessage strips emails, JWTs and long opaque tokens, and caps length", () => {
  const out = scrubMessage(
    "dup key (email)=(jane.doe@example.com) jwt eyJhbGciOi.eyJzdWIi.sig123 key sk_live_abcdefghijklmnopqrstuvwxyz0123456789",
  );
  assert.doesNotMatch(out, /jane\.doe|example\.com|eyJ|abcdefghijklmnopqrstuvwxyz/);
  assert.match(out, /\[email\]/);
  assert.equal(scrubMessage("ab ".repeat(500)).length, 300);
});

test("OTLP payload carries service, environment, severity and attributes", () => {
  const p = buildOtlpPayload({ environment: "production" }, "error", "boom", { a: "b", n: 3, u: undefined }, 1_700_000_000_000);
  const rl = p.resourceLogs[0];
  const res = Object.fromEntries(rl.resource.attributes.map((a) => [a.key, a.value]));
  assert.deepEqual(res["service.name"], { stringValue: SERVICE_NAME });
  assert.deepEqual(res["deployment.environment"], { stringValue: "production" });
  const rec = rl.scopeLogs[0].logRecords[0];
  assert.equal(rec.severityText, "ERROR");
  assert.equal(rec.severityNumber, 17);
  assert.equal(rec.timeUnixNano, "1700000000000000000");
  assert.deepEqual(rec.body, { stringValue: "boom" });
  assert.deepEqual(rec.attributes.map((a) => a.key), ["a", "n"]);
});

test("request error record uses the route pattern, never the raw path, and no PII", () => {
  const err = Object.assign(new Error("failed for jane@example.com"), { digest: "d123" });
  const { body, attrs } = requestErrorRecord(
    err,
    { method: "POST", path: "/unsubscribe/secret-token?email=jane@example.com" } as { method: string },
    { routerKind: "App Router", routePath: "/unsubscribe/[token]", routeType: "route" },
  );
  const flat = JSON.stringify({ body, attrs });
  assert.doesNotMatch(flat, /secret-token|jane|example\.com/);
  assert.equal(attrs["http.route"], "/unsubscribe/[token]");
  assert.equal(attrs["error.digest"], "d123");
  // A different case: a non-Error throw value is still recorded, not fabricated.
  const other = requestErrorRecord("plain string", { method: "GET" }, { routerKind: "App Router", routePath: "/jobs", routeType: "render" });
  assert.equal(other.attrs["error.type"], "string");
});

test("logServer is a true no-op when unset: no fetch, no throw", () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => { calls++; return Promise.resolve(new Response()); }) as typeof fetch;
  const saved = { e: process.env.POSTHOG_LOGS_ENABLED, k: process.env.NEXT_PUBLIC_POSTHOG_KEY };
  try {
    delete process.env.POSTHOG_LOGS_ENABLED;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    logServer("error", "x", {});
    assert.equal(calls, 0);
    process.env.POSTHOG_LOGS_ENABLED = "1";
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    logServer("info", "dropped at the warn floor", {});
    assert.equal(calls, 0);
    logServer("error", "sent", {});
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    if (saved.e === undefined) delete process.env.POSTHOG_LOGS_ENABLED; else process.env.POSTHOG_LOGS_ENABLED = saved.e;
    if (saved.k === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY; else process.env.NEXT_PUBLIC_POSTHOG_KEY = saved.k;
  }
});
