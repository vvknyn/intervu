import { test } from "node:test";
import assert from "node:assert/strict";
import {
  followEmailPrompt,
  followEmailSentLine,
  followEmailVerifiedLine,
  followPersistCta,
  followPersistLine,
  followPersistValueLine,
} from "../../src/lib/follows/persist-copy";

test("followPersistLine names the company and promises a weekly note", () => {
  assert.equal(
    followPersistLine("Anthropic"),
    "Watching Anthropic. Get a weekly note when they post.",
  );
});

test("followPersistCta is a short action label", () => {
  assert.equal(followPersistCta(), "Email me when they post");
});

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
