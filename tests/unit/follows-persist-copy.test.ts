import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
