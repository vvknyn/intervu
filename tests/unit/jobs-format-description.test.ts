import { test } from "node:test";
import assert from "node:assert/strict";
import {
  repairRunTogethers,
  stripResidualHtml,
  extractBoldLead,
  formatDescription,
} from "../../src/lib/jobs/format-description";

// Live prod bug (2026-08-01): a flattened HTML→text block join left a
// 4-digit year glued directly to the next block's Capitalized first word —
// "2026Job" — with no whitespace boundary repaired. digit→Capital is a
// distinct run-together class from the existing lowercase→Capital repair
// and needed its own rule (see repairRunTogethers (b3)).
test("repairRunTogethers: splits the observed digit-year→Capital run-together", () => {
  const input = "Accepting applications until: 28 August 2026Job Description Your Role:";
  assert.match(repairRunTogethers(input), /2026 Job Description/);
});

test("repairRunTogethers: digit→Capital class — 4+ more cases beyond the observed bug", () => {
  assert.equal(
    repairRunTogethers("We closed 500Employees strong this year."),
    "We closed 500 Employees strong this year.",
  );
  assert.equal(
    repairRunTogethers("The team grew to 120Engineers in five years."),
    "The team grew to 120 Engineers in five years.",
  );
  assert.equal(
    repairRunTogethers("Founded in 1999Delaware as a two-person startup."),
    "Founded in 1999 Delaware as a two-person startup.",
  );
  assert.equal(
    repairRunTogethers("Apply before the 2026Deadline passes."),
    "Apply before the 2026 Deadline passes.",
  );
  // A comma-grouped number glued to the next block's heading — same class,
  // digit run is the trailing "000" group, not the whole "50,000".
  assert.equal(
    repairRunTogethers("Serving 50,000Customers worldwide."),
    "Serving 50,000 Customers worldwide.",
  );
});

test("repairRunTogethers: must NOT split legitimate glued tokens", () => {
  // Acronym+digit codes: nothing lowercase follows the trailing capital, so
  // the digit-run+Capital+lowercase pattern never matches these regardless
  // of the digit-run gate.
  assert.equal(
    repairRunTogethers("B2B sales experience is required for this role."),
    "B2B sales experience is required for this role.",
  );
  assert.equal(
    repairRunTogethers("Amazon S3 storage buckets back up nightly snapshots."),
    "Amazon S3 storage buckets back up nightly snapshots.",
  );
  assert.equal(
    repairRunTogethers("A/B testing drove the conversion improvements."),
    "A/B testing drove the conversion improvements.",
  );
  // "401k" / "401K": the character right after the digit run is lowercase
  // ("k"), so the rule (which requires Capital immediately after the digit
  // run) never fires — even glued directly to the next Capitalized word.
  assert.equal(
    repairRunTogethers("Includes 401kMatching up to 6% of salary."),
    "Includes 401kMatching up to 6% of salary.",
  );
  // Sub-3-digit runs (years abbreviated, version numbers, disease-year
  // codes) are below the digit-run gate, so glued Capital words survive —
  // mirrors the 4-char lowercase gate that already protects "iPhone".
  assert.equal(
    repairRunTogethers("The COVID19Guidelines applied to every office."),
    "The COVID19Guidelines applied to every office.",
  );
  assert.equal(
    repairRunTogethers("Upgraded to iOS15Compatibility this release."),
    "Upgraded to iOS15Compatibility this release.",
  );
});

test("repairRunTogethers: existing lowercase→Capital and punctuation classes are untouched", () => {
  assert.equal(repairRunTogethers("This yearCentene grew fast."), "This year Centene grew fast.");
  assert.equal(repairRunTogethers("required.5+ years"), "required. 5+ years");
  assert.equal(repairRunTogethers("Purpose:Oversee all operations"), "Purpose: Oversee all operations");
  assert.equal(repairRunTogethers("great fit.Apply today"), "great fit. Apply today");
});

/* ---------------------------------------------------------------------
 * Squared design-system pass (2026-08-02) — DescBlock structure coverage.
 * Subspace strips HTML at ingest (PublicJob.description is plain text —
 * see the module doc comment), so `formatDescription` is the ONLY render
 * path; there is no separate "raw HTML" branch to test. `stripResidualHtml`
 * is defense-in-depth for whatever occasionally leaks through anyway.
 * ------------------------------------------------------------------- */

test("stripResidualHtml: HTML-shaped description — tags stripped, text kept", () => {
  const input = "<p>We build <strong>great</strong> products.</p><ul><li>Design</li><li>Ship</li></ul>";
  assert.equal(stripResidualHtml(input), "We build great products.DesignShip");
});

test("stripResidualHtml: adversarial — script tag and event-attribute markup neutralized", () => {
  assert.equal(stripResidualHtml("Great role<script>alert(document.cookie)</script> for you."), "Great role for you.");
  // A self-closing tag carrying an event-handler attribute: the whole tag
  // (attributes included) is dropped, not just its name.
  assert.equal(stripResidualHtml('Apply now<img src=x onerror="alert(1)"> today.'), "Apply now today.");
  // Real prose that merely LOOKS like a comparison, not a tag (no letter
  // immediately after "<"), must survive untouched.
  assert.equal(stripResidualHtml("Shipped in < 3 weeks with a<b conversion lift."), "Shipped in < 3 weeks with a<b conversion lift.");
});

test("formatDescription: text-with-bullets description groups adjacent bullets into a list block", () => {
  const raw = "What you'll do:\n- Own the roadmap\n- Ship weekly\n- Partner with sales";
  const blocks = formatDescription(raw);
  const list = blocks.find((b) => b.type === "list");
  assert.ok(list, "expected a list block");
  assert.deepEqual(list!.items, ["Own the roadmap", "Ship weekly", "Partner with sales"]);
});

test("extractBoldLead: a recognized short label glued to prose splits into lead + rest", () => {
  const split = extractBoldLead("Your role. We are looking for a Senior Product Designer to join our team.");
  assert.ok(split);
  assert.equal(split!.lead, "Your role.");
  assert.equal(split!.rest, "We are looking for a Senior Product Designer to join our team.");
});

test("extractBoldLead: an ordinary sentence that merely starts with a short capitalized phrase is left alone", () => {
  assert.equal(extractBoldLead("She left. The next day everyone noticed she was gone for good."), null);
});

test("formatDescription: 'Label. content' bold-lead paragraph renders on the para block", () => {
  const raw =
    "Your role. We are looking for a Senior Product Designer to join our small design team within engineering.";
  const blocks = formatDescription(raw);
  const para = blocks.find((b) => b.type === "para");
  assert.ok(para);
  assert.equal(para!.lead, "Your role.");
  assert.match(para!.text!, /^We are looking for a Senior Product Designer/);
});

test("formatDescription: run-together regression case reads as clean, separate blocks", () => {
  const raw = "Accepting applications until 28 August 2026Job Description Your Role:Own the roadmap end to end.";
  const blocks = formatDescription(raw);
  const joined = blocks.map((b) => b.text ?? b.items?.join(" ")).join(" ");
  assert.match(joined, /2026 Job Description/);
  assert.doesNotMatch(joined, /2026Job/);
});
