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

/**
 * Live prod bug (2026-08-21, company-about-line ground-truth audit): an
 * ALL-CAPS section heading glued directly to its Titlecase body with no
 * separator at all — no bold marker, no newline, no colon — e.g. Greystar's
 * index description opens with "ABOUT GREYSTARGreystar is a leading, fully
 * integrated global real estate platform…". Unlike the genuinely-ambiguous
 * "## Company Description CREATIVITY IS OUR SUPERPOWER" case above (no
 * case-transition signal at that boundary), the ALL-CAPS→Titlecase
 * transition here IS a knowable boundary — same run-together family as
 * repairRunTogethers' lowercase→Capital rule, just promoted to a paragraph
 * break since an isolated ALL-CAPS run is itself a recognized heading shape.
 */
test("formatDescription: ALL-CAPS heading glued directly to its Titlecase body (observed Greystar bug) splits into heading + para", () => {
  const raw =
    "ABOUT GREYSTARGreystar is a leading, fully integrated global real estate platform offering property management and investment services.";
  const blocks = formatDescription(raw);
  const heading = blocks.find((b) => b.type === "heading");
  const para = blocks.find((b) => b.type === "para");
  assert.ok(heading, "expected a heading block");
  assert.equal(heading!.text, "ABOUT GREYSTAR");
  assert.ok(para, "expected a para block");
  assert.match(para!.text!, /^Greystar is a leading/);
  // The bug: the glued heading text must NOT leak into the body block.
  assert.doesNotMatch(para!.text!, /^ABOUT GREYSTAR/);
});

test("formatDescription: the same glued-ALL-CAPS-heading class on a different heading and company splits identically (class-wide, not Greystar-specific)", () => {
  const raw =
    "JOB DESCRIPTION SUMMARYThis role manages customer support to residents by coordinating service requests and accounting issues.";
  const blocks = formatDescription(raw);
  const heading = blocks.find((b) => b.type === "heading");
  const para = blocks.find((b) => b.type === "para");
  assert.ok(heading, "expected a heading block");
  assert.equal(heading!.text, "JOB DESCRIPTION SUMMARY");
  assert.ok(para, "expected a para block");
  assert.match(para!.text!, /^This role manages/);
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

test("formatDescription: whitespace-only blank lines are paragraph breaks (Greenhouse \\n \\n)", () => {
  const raw = "The role\n \nHelloFresh owns onboarding.\n \nWhat you'll do\n \nOwn the roadmap.";
  const blocks = formatDescription(raw);
  const headings = blocks.filter((b) => b.type === "heading").map((b) => b.text);
  assert.ok(headings.some((h) => /the role/i.test(h ?? "")), `expected The role heading, got ${JSON.stringify(headings)}`);
  assert.ok(headings.some((h) => /what you'll do/i.test(h ?? "")), `expected What you'll do heading, got ${JSON.stringify(headings)}`);
  const paras = blocks.filter((b) => b.type === "para").map((b) => b.text ?? "");
  assert.ok(paras.some((t) => t.includes("HelloFresh")), "HelloFresh brand must stay unsplit");
  assert.ok(!paras.some((t) => t.startsWith("The role Hello")), "heading must not glue onto body");
});

test("normalizeMarkdown: a mismatched ***bold** run leaves no stray asterisk", () => {
  // Seen on a tracked 1Password role (2026-09-30): the pursuit page printed "***1Password is growing**".
  const out = normalizeMarkdown("***1Password is growing** We've surpassed $400M in ARR.");
  assert.equal(out, "1Password is growing We've surpassed $400M in ARR.");
  // Bullets and arithmetic keep their stars' meaning.
  assert.match(normalizeMarkdown("Skills:\n* Python\n* SQL"), /- Python\n- SQL/);
  assert.match(normalizeMarkdown("A 5*3 grid."), /5\*3/);
});

test("formatDescription: Anvil flattened JD keeps parenthetical dash intact and promotes About <Company>, Total Compensation, Vacancy Status, and The Role", () => {
  const raw =
    "Product Manager About Anvil Anvil is a trusted partner in the defence industry, delivering cutting-edge solutions that enhance military capabilities and operational effectiveness.\n\nJob Type\nFull Time (Remote Canada / Hybrid - Ottawa) Total Compensation: CAD $140,000 - $165,000 base salary - Placement within range based on experience and qualifications Vacancy Status: This posting is for an existing vacancy at Anvil. We are actively hiring for this role The Role We're looking for a Product Manager to drive the execution of a complex, mission-critical software platform serving military customers.";
  const blocks = formatDescription(raw);
  const headings = blocks.filter((b) => b.type === "heading").map((b) => b.text);
  assert.ok(headings.includes("About Anvil"), `expected About Anvil heading, got ${JSON.stringify(headings)}`);
  assert.ok(headings.includes("Job Type"), `expected Job Type heading, got ${JSON.stringify(headings)}`);
  assert.ok(headings.includes("Total Compensation"), `expected Total Compensation heading, got ${JSON.stringify(headings)}`);
  assert.ok(headings.includes("Vacancy Status"), `expected Vacancy Status heading, got ${JSON.stringify(headings)}`);
  assert.ok(headings.includes("The Role"), `expected The Role heading, got ${JSON.stringify(headings)}`);

  const paras = blocks.filter((b) => b.type === "para").map((b) => b.text ?? "");
  assert.ok(
    paras.some((p) => p.includes("Full Time (Remote Canada / Hybrid - Ottawa)")),
    `expected parenthetical dash to stay intact, got ${JSON.stringify(paras)}`,
  );
  const lists = blocks.filter((b) => b.type === "list");
  assert.ok(
    !lists.some((l) => (l.items ?? []).some((item) => item.startsWith("Ottawa)"))),
    "must not split ' - Ottawa)' into a bogus bullet item",
  );
});

