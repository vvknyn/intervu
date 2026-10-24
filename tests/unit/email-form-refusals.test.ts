import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_FORM_INVALID_MESSAGE, emailFormRateLimitMessage } from "../../src/lib/shield/email-form-refusals";
import {
  allowConnectWaitlistRequest,
  allowConnectWaitlistSubmit,
  clearRateLimitStateForTests,
  CONNECT_WAITLIST_MAX_REQUESTS,
  EMAIL_FORM_SUBMIT_MAX_REQUESTS,
} from "../../src/lib/shield/rate-limit";

/**
 * The OpenClaw waitlist (/connect, /openclaw) used to answer a per-IP refusal with "Too many attempts — try
 * again in a few minutes.", counted on every submit before Turnstile: the
 * pattern that refused a real signup on 2026-10-01 (lib/shield/rate-limit.ts).
 */

const ROOT = join(__dirname, "..", "..");
const ACTIONS = [
  { file: "connect-waitlist.ts", submit: "allowConnectWaitlistSubmit(ip)", write: "allowConnectWaitlistRequest(ip)" },
];

test("a per-IP refusal names the wait in minutes and a way in it doesn't cover", () => {
  const message = emailFormRateLimitMessage(7 * 60_000 + 1, "email us at hello@example.com and we'll add you.");
  assert.equal(
    message,
    "Too many tries from your network just now. Try again in 8 minutes, or email us at hello@example.com and we'll add you.",
  );
  assert.doesNotMatch(message, /a few minutes|attempts/);
});

test("a malformed email says what a full address looks like, not the schema's field path", () => {
  assert.equal(EMAIL_FORM_INVALID_MESSAGE, "Enter a full email address, like you@example.com.");
  assert.doesNotMatch(EMAIL_FORM_INVALID_MESSAGE, /email:|must be/);
});

for (const action of ACTIONS) {
  test(`${action.file}: flood guard before Turnstile, write budget after it and before Firestore`, () => {
    const src = readFileSync(join(ROOT, "src", "actions", action.file), "utf8");
    const at = (needle: string) => {
      const index = src.indexOf(needle);
      assert.ok(index >= 0, `${needle} is in ${action.file}`);
      return index;
    };
    assert.ok(at("validate(") < at(action.submit), "a malformed email is refused before any limit counts it");
    assert.ok(at(action.submit) < at("verifyTurnstile("), "the flood guard runs before siteverify");
    assert.ok(at("verifyTurnstile(") < at(action.write), "a refused security check never spends the write budget");
    assert.ok(at(action.write) < at("getAdminDb()"), "the write budget runs before Firestore");
  });
}

test("no server action answers with the old vague limiter line", () => {
  const dir = join(ROOT, "src", "actions");
  const offenders = readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => /Too many attempts|try again in a few minutes/i.test(readFileSync(join(dir, name), "utf8")));
  assert.deepEqual(offenders, []);
});

test("each form's flood guard and write budget are separate stores, and the guard sits well above a person", () => {
  clearRateLimitStateForTests();
  const now = 1_000_000;
  for (const [submit, write] of [
    [allowConnectWaitlistSubmit, allowConnectWaitlistRequest],
  ] as const) {
    for (let i = 0; i < EMAIL_FORM_SUBMIT_MAX_REQUESTS; i++) assert.equal(submit("9.9.9.9", now), true);
    assert.equal(submit("9.9.9.9", now), false, "the flood guard is finite");
    for (let i = 0; i < CONNECT_WAITLIST_MAX_REQUESTS; i++) assert.equal(write("9.9.9.9", now), true, "submits never spent the write budget");
    assert.equal(write("9.9.9.9", now), false);
  }
  assert.ok(EMAIL_FORM_SUBMIT_MAX_REQUESTS >= 6 * CONNECT_WAITLIST_MAX_REQUESTS);
  clearRateLimitStateForTests();
});
