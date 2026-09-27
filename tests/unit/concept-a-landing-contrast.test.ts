import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = readFileSync("src/components/onboarding/ConceptALanding.tsx", "utf8");
const POSTCARD = SRC.match(/function PostcardCard[\s\S]*?^}/m)?.[0] ?? "";

test("Concept A postcards render real titles, meta, and Live label", () => {
  assert.match(POSTCARD, /data-testid="concept-a-postcard-title"/);
  assert.match(POSTCARD, /\{title\}/);
  assert.match(POSTCARD, /\{meta\}/);
  assert.match(POSTCARD, />Live</);
  const titleOpenTag =
    POSTCARD.match(/<p[\s\S]*?data-testid="concept-a-postcard-title"[\s\S]*?>/m)?.[0] ?? "";
  assert.doesNotMatch(titleOpenTag, /\baria-hidden\b/);
});

test("Concept A postcard Live uses postcard-safe tokens on cream", () => {
  assert.match(POSTCARD, /text-live-on-postcard/);
  assert.match(POSTCARD, /bg-live-on-postcard/);
  assert.doesNotMatch(POSTCARD, /\btext-live\b(?!-on-postcard)/);
});

test("Concept A does not hide main or use design-lint file exemption", () => {
  assert.doesNotMatch(SRC, /design-lint-allow-file/);
  assert.doesNotMatch(SRC, /main\.style\.display/);
  assert.doesNotMatch(SRC, /display\s*=\s*["']none["']/);
});

test("Concept A keeps poster texture and real postcard stack", () => {
  assert.match(SRC, /poster-noise/);
  assert.match(SRC, /Remote AI Roles/);
  assert.match(SRC, /overflow-visible/);
});
