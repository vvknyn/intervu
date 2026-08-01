import { test } from "node:test";
import assert from "node:assert/strict";
import { repairRunTogethers } from "../../src/lib/jobs/format-description";

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
