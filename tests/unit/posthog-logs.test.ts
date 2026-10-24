import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LOGS_ENDPOINT,
  SERVICE_NAME,
  buildOtlpPayload,
  levelPasses,
  logServer,
  requestErrorLevel,
  requestErrorRecord,
  resolveLogsConfig,
  sanitizeLogAttrs,
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

test("OTLP payload carries service, environment, severity and attributes", () => {
  const p = buildOtlpPayload({ environment: "production" }, "error", "boom", { reason: "b", duration_ms: 3, outcome: undefined }, 1_700_000_000_000);
  const rl = p.resourceLogs[0];
  const res = Object.fromEntries(rl.resource.attributes.map((a) => [a.key, a.value]));
  assert.deepEqual(res["service.name"], { stringValue: SERVICE_NAME });
  assert.deepEqual(res["deployment.environment"], { stringValue: "production" });
  const rec = rl.scopeLogs[0].logRecords[0];
  assert.equal(rec.severityText, "ERROR");
  assert.equal(rec.severityNumber, 17);
  assert.equal(rec.timeUnixNano, "1700000000000000000");
  assert.deepEqual(rec.body, { stringValue: "boom" });
  assert.deepEqual(rec.attributes.map((a) => a.key), ["reason", "duration_ms"]);
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

test("request error record exports no error text: not the message, not a name or digest that carries text", () => {
  const route = { routerKind: "App Router", routePath: "/jobs", routeType: "route" };
  const req = { method: "POST" };
  const message = requestErrorRecord(new Error("duplicate key (email)=(jane.doe@example.com)"), req, route);
  assert.doesNotMatch(JSON.stringify(message), /jane|example\.com|duplicate key/);
  assert.equal(message.attrs["error.type"], "Error");
  // Another free-text vector: a custom name and a digest the thrower filled with text.
  const named = Object.assign(new Error("x"), { name: "failed for bob@example.org", digest: "reset token abc for bob@example.org" });
  const flat = JSON.stringify(requestErrorRecord(named, req, route));
  assert.doesNotMatch(flat, /bob|example\.org|reset token/);
  // A class-name-shaped error type and a hash-shaped digest still come through.
  const ok = requestErrorRecord(Object.assign(new TypeError("t"), { digest: "d123" }), req, route);
  assert.equal(ok.attrs["error.type"], "TypeError");
  assert.equal(ok.attrs["error.digest"], "d123");
});

test("a render the visitor abandoned mid-stream logs under the warn floor; other request errors stay errors", () => {
  // React's cancel reason when the response closes before the stream ends (journey runs navigating away, 2026-10-02).
  assert.equal(requestErrorLevel(new Error("The destination stream closed early.")), "info");
  assert.equal(levelPasses(requestErrorLevel(new Error("The destination stream closed early.")), "warn"), false);
  assert.equal(requestErrorLevel(new Error("The destination stream errored while writing data.")), "error");
  assert.equal(requestErrorLevel(new Error("Cannot read properties of undefined")), "error");
  assert.equal(requestErrorLevel("plain string"), "error");
  assert.equal(requestErrorLevel(undefined), "error");
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

test("exporter drops every non-allow-listed attribute, whoever the caller is", () => {
  const sent = buildOtlpPayload({ environment: "production" }, "warn", "x", {
    uid: "user_01HXYZ",
    user_id: "user_01HXYZ",
    email: "jane@example.com",
    ip: "203.0.113.9",
    "client.address": "203.0.113.9",
    user_agent: "Mozilla/5.0 (Macintosh)",
    "url.full": "https://velai.app/jobs?q=nurse",
    "url.query": "q=nurse",
    query: "senior nurse",
    search_text: "senior nurse",
    resume: "Jane Doe, 10 years at Acme",
    // allowed keys are kept...
    reason: "turnstile",
    duration_ms: 2000,
    "http.route": "/unsubscribe/[token]",
  }, 1_700_000_000_000);
  const keys = sent.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.map((a) => a.key);
  assert.deepEqual(keys, ["reason", "duration_ms", "http.route"]);
});

test("exporter drops an allow-listed key whose value is free text, an address or a URL query", () => {
  const out = sanitizeLogAttrs({
    reason: "jane@example.com",
    error_name: "failed for bob",
    "http.route": "/jobs?q=nurse",
    "company.domain": "acme.com",
    error_codes: "invalid_grant,rate_limited",
    outcome: "refused",
  });
  assert.deepEqual(out, { "company.domain": "acme.com", error_codes: "invalid_grant,rate_limited", outcome: "refused" });
});

test("the privacy page lists the same fields the exporter allows", () => {
  const page = readFileSync(join(__dirname, "../../src/app/privacy/page.tsx"), "utf8");
  assert.match(page, /LOG_ATTR_ALLOW_LIST\.map/);
  assert.match(page, /error and slow-request logs to PostHog/);
});

test("the log body is redacted at the exporter: emails, IPv4/IPv6 and URL query strings go, fixed text stays", () => {
  const body = (text: string) =>
    buildOtlpPayload({ environment: "production" }, "error", text, {}, 1).resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue;
  const fixed = "page error on GET /unsubscribe/[token]";
  assert.equal(body(fixed), fixed);
  assert.equal(body("failed for a.b+c@mail.example.com"), "failed for [redacted]");
  assert.equal(body("from 203.0.113.42 refused"), "from [redacted] refused");
  assert.equal(body("from 2001:db8::8a2e:370:7334 and ::1 refused"), "from [redacted] and [redacted] refused");
  assert.equal(body("GET https://velai.co/jobs?q=nurse&city=nyc failed"), "GET https://velai.co/jobs[redacted] failed");
  assert.ok(!body("x 10.0.0.7 y u@v.io z https://a.b/c?token=s3cret").match(/10\.0|@|s3cret/));
});
