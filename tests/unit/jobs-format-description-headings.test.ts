import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMarkdown, formatDescription } from "../../src/lib/jobs/format-description";

/**
 * ATX headings whose text is bold-delimited (`# **Text**`) or
 * newline-terminated (`# Text\n`) have a KNOWABLE end, so normalizeMarkdown
 * can isolate them into their own block deterministically — see the doc
 * comment on that rule in format-description.ts. A truly run-together
 * `## Heading body…` line (no bold, no newline) has no knowable boundary
 * and is deliberately left at today's (imperfect) behavior.
 *
 * Live prod bug (2026-08-05): Ashby collapses newlines on ingest, so a
 * `# **About Zip** Zip is the AI platform…` heading arrived glued to its
 * own paragraph and rendered as "About Zip Zip is the AI platform…" — the
 * heading never got promoted because HEADING_KEYWORDS can't enumerate every
 * "About {Company}"-shaped heading a source might use.
 */

test("formatDescription: bold ATX heading glued to its paragraph (observed Ashby bug) splits into heading + para", () => {
  const raw = "# **About Zip** Zip is the AI platform that helps companies hire faster and smarter every day.";
  const blocks = formatDescription(raw);
  const heading = blocks.find((b) => b.type === "heading");
  const para = blocks.find((b) => b.type === "para");
  assert.ok(heading, "expected a heading block");
  assert.equal(heading!.text, "About Zip");
  assert.ok(para, "expected a para block");
  assert.match(para!.text!, /^Zip is the AI platform/);
  // The bug: the two words "About Zip" and "Zip is…" must NOT run together.
  assert.doesNotMatch(para!.text!, /^About Zip/);
});

test("formatDescription: a different bold-heading case (##, different keyword) also splits", () => {
  const raw = "## **Your Role** We're looking for a Senior Backend Engineer to join our platform team.";
  const blocks = formatDescription(raw);
  const heading = blocks.find((b) => b.type === "heading");
  const para = blocks.find((b) => b.type === "para");
  assert.ok(heading);
  assert.equal(heading!.text, "Your Role");
  assert.ok(para);
  assert.match(para!.text!, /^We're looking for a Senior Backend Engineer/);
});

test("formatDescription: bold heading followed by collapsed inline bullets renders heading + list", () => {
  const raw = "## **Perks & Benefits** - Free lunch - Gym stipend - Health insurance";
  const blocks = formatDescription(raw);
  const heading = blocks.find((b) => b.type === "heading");
  const list = blocks.find((b) => b.type === "list");
  assert.ok(heading, "expected a heading block");
  assert.equal(heading!.text, "Perks & Benefits");
  assert.ok(list, "expected a list block");
  assert.deepEqual(list!.items, ["Free lunch", "Gym stipend", "Health insurance"]);
});

test("formatDescription: newline-terminated plain heading (no bold) still splits into heading + para", () => {
  const raw = "## Responsibilities\nOwn the roadmap end to end and partner closely with design.";
  const blocks = formatDescription(raw);
  const heading = blocks.find((b) => b.type === "heading");
  const para = blocks.find((b) => b.type === "para");
  assert.ok(heading, "expected a heading block");
  assert.equal(heading!.text, "Responsibilities");
  assert.ok(para);
  assert.match(para!.text!, /^Own the roadmap/);
});

test("normalizeMarkdown: mid-prose bold text with no leading '#' is stripped to plain text, not treated as a heading", () => {
  const raw = "This role requires **strong communication** skills and 5+ years of experience.";
  const out = normalizeMarkdown(raw);
  assert.match(out, /strong communication/);
  assert.doesNotMatch(out, /\*\*/);
  // Not isolated into its own block — no fresh blank-line pair was inserted.
  assert.doesNotMatch(out, /\n\n/);
});

test("normalizeMarkdown: heading text already ending ':' produces no double colon", () => {
  const raw = "# **Position Purpose:** Oversee daily branch operations and staff.";
  const out = normalizeMarkdown(raw);
  assert.match(out, /Position Purpose:/);
  assert.doesNotMatch(out, /Position Purpose::/);

  const blocks = formatDescription(raw);
  const heading = blocks.find((b) => b.type === "heading");
  assert.ok(heading);
  assert.equal(heading!.text, "Position Purpose");
});

test("formatDescription: truly run-together heading (no bold, no newline) is left at today's behavior — no crash, still readable prose", () => {
  const raw = "## Company Description CREATIVITY IS OUR SUPERPOWER and we live it daily.";
  const blocks = formatDescription(raw);
  // Not asserting a specific split here (today's known-imperfect behavior for
  // this shape) — only that the text survives intact with the marker gone.
  const joined = blocks.map((b) => b.text ?? b.items?.join(" ")).join(" ");
  assert.match(joined, /CREATIVITY IS OUR SUPERPOWER/);
  assert.doesNotMatch(joined, /##/);
});
