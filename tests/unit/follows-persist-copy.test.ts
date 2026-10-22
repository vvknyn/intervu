import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  followEmailPrompt,
  followEmailSentLine,
  followEmailVerifiedLine,
  confirmLinkCreatesAccountLine,
  followPersistValueLine,
} from "../../src/lib/follows/persist-copy";

const ROOT = path.join(__dirname, "..", "..");

test("followPersistValueLine explains account creation benefit", () => {
  assert.equal(
    followPersistValueLine("Anthropic"),
    "Create a free account — we'll email you when Anthropic posts.",
  );
});

test("followEmailPrompt names the company and scopes the promise", () => {
  assert.equal(
    followEmailPrompt("Anthropic"),
    "Get an email when Anthropic posts or closes roles. Nothing else.",
  );
});

test("followEmailSentLine tells the visitor to check their inbox", () => {
  assert.equal(followEmailSentLine(), "Check your inbox — click the link to confirm.");
});

test("followEmailVerifiedLine confirms the watch is live", () => {
  assert.equal(
    followEmailVerifiedLine("Anthropic"),
    "You're watching Anthropic. We'll email you when something changes.",
  );
});

/**
 * Class guard for the "how can I follow a company when I have not shared
 * an email???" bug: `followPersistLine`/`followPersistCta` used to render a
 * present-tense "Watching X" claim with a weekly-note promise for a guest
 * who had done nothing but click a button — no server row, no address, no
 * channel. Every OTHER exported line here describes a pending/future state
 * (submit this, we'll email you once you do); only the verified line may
 * claim the follow is already live.
 */
test("only the verified line claims the follow is already active — every other line stays in the future tense", () => {
  const presentTenseClaim = /\byou'?re watching\b/i;
  const copy: Record<string, string> = {
    followPersistValueLine: followPersistValueLine("Acme"),
    followEmailPrompt: followEmailPrompt("Acme"),
    followEmailSentLine: followEmailSentLine(),
    followEmailVerifiedLine: followEmailVerifiedLine("Acme"),
  };

  for (const [name, line] of Object.entries(copy)) {
    if (name === "followEmailVerifiedLine") {
      assert.match(line, presentTenseClaim, `${name} should confirm the watch is live`);
      continue;
    }
    assert.doesNotMatch(line, presentTenseClaim, `${name} must not claim the follow is already active`);
  }
});

test("the ungated pre-verification prompt never comes back", () => {
  const src = readFileSync(path.join(ROOT, "src/lib/follows/persist-copy.ts"), "utf8");
  assert.ok(!/export function followPersistLine/.test(src), "followPersistLine must stay deleted");
  assert.ok(!/export function followPersistCta/.test(src), "followPersistCta must stay deleted");
});

test("confirmLinkCreatesAccountLine says the link creates the account", () => {
  assert.equal(confirmLinkCreatesAccountLine(), "The confirm link also creates your free account.");
});
