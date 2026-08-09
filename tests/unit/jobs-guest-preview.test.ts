import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGuestPreview, GUEST_PREVIEW_CHAR_LIMIT } from "../../src/lib/jobs/guest-preview";

// Grok UX wave G4 — the guest job-detail gate replaced blur-as-paywall with
// a real, truncated preview of the description. These cover the pure
// decision `buildGuestPreview` makes: how much text to show and whether it
// was cut.

test("buildGuestPreview: short description passes through unchanged, not truncated", () => {
  const raw = "We're hiring a backend engineer to help scale our platform.";
  const preview = buildGuestPreview(raw);
  assert.equal(preview.text, raw);
  assert.equal(preview.truncated, false);
});

test("buildGuestPreview: empty/null/undefined description yields an empty, non-truncated preview", () => {
  assert.deepEqual(buildGuestPreview(null), { text: "", truncated: false });
  assert.deepEqual(buildGuestPreview(undefined), { text: "", truncated: false });
  assert.deepEqual(buildGuestPreview("   \n\n  "), { text: "", truncated: false });
});

test("buildGuestPreview: long description truncates at a word boundary, never mid-word", () => {
  const word = "engineering ";
  const raw = word.repeat(80); // well past the 500-char limit, plenty of spaces
  const preview = buildGuestPreview(raw);
  assert.equal(preview.truncated, true);
  assert.ok(preview.text.length <= GUEST_PREVIEW_CHAR_LIMIT);
  assert.ok(!preview.text.endsWith("engineerin")); // never a cut mid-word
  assert.equal(preview.text.trim().endsWith("engineering") || preview.text.trim() === "engineering".trim(), true);
});

test("buildGuestPreview: an unbroken run past the limit with no space falls back to a hard cut at the limit", () => {
  const raw = "x".repeat(GUEST_PREVIEW_CHAR_LIMIT + 50);
  const preview = buildGuestPreview(raw);
  assert.equal(preview.truncated, true);
  assert.equal(preview.text.length, GUEST_PREVIEW_CHAR_LIMIT);
});

test("buildGuestPreview: strips residual HTML tags before truncating (same sanitization formatDescription uses)", () => {
  const raw = "<p>Build <strong>delightful</strong> products.</p><script>evil()</script>";
  const preview = buildGuestPreview(raw);
  assert.equal(preview.text, "Build delightful products.");
});

test("buildGuestPreview: normalizes literal Markdown the same way the full-description renderer does", () => {
  const raw = "## About the role\n\nWe ship **fast**.";
  const preview = buildGuestPreview(raw);
  assert.ok(!preview.text.includes("##"));
  assert.ok(!preview.text.includes("**"));
  assert.ok(preview.text.includes("About the role"));
  assert.ok(preview.text.includes("We ship fast."));
});

test("buildGuestPreview: respects a custom limit argument", () => {
  const raw = "one two three four five six seven eight nine ten";
  const preview = buildGuestPreview(raw, 10);
  assert.equal(preview.truncated, true);
  assert.ok(preview.text.length <= 10);
});
