import { test } from "node:test";
import assert from "node:assert/strict";
import { descriptionLede } from "../../src/lib/presentation/description";

// --- Two different ATS boilerplate shapes ----------------------------------

test("strips a 'Job Requisition ID #X' header + 'English posting follows' marker (audit example)", () => {
  const raw =
    "Job Requisition ID #26WD99545 English posting follows. We are looking for a talented software engineer to join our growing team in Waterloo.";
  assert.equal(
    descriptionLede(raw),
    "We are looking for a talented software engineer to join our growing team in Waterloo.",
  );
});

test("strips a differently-shaped 'Req ID:' header + 'French version follows' marker", () => {
  const raw =
    "Req ID: R-4471829. French version follows. Nous recherchons un developpeur passionne pour rejoindre notre equipe basee a Montreal.";
  assert.equal(
    descriptionLede(raw),
    "Nous recherchons un developpeur passionne pour rejoindre notre equipe basee a Montreal.",
  );
});

// --- False-positive survivors (shape regex must not eat real prose) --------

test("does not strip 'Requisition Specialist' as a req-ID header — no digit in the code token (false-positive survivor)", () => {
  const raw = "Requisition Specialist needed for our Toronto office. We are hiring an experienced recruiter.";
  assert.equal(descriptionLede(raw), raw);
});

test("does not strip 'This posting follows our standard process' — no terminal punctuation after the verb phrase (false-positive survivor)", () => {
  const raw = "This posting follows our standard hiring process and typically takes two weeks to complete.";
  assert.equal(descriptionLede(raw), raw);
});

// --- Other behavior ---------------------------------------------------------

test("leaves ordinary prose with no boilerplate opener untouched", () => {
  const raw = "We are looking for a talented software engineer to join our growing team.";
  assert.equal(descriptionLede(raw), raw);
});

test("truncates a long description to ~200 chars at a word boundary", () => {
  const sentence = "This role involves building reliable systems and working closely with a cross-functional team of engineers, designers, and product managers. ";
  const raw = sentence.repeat(4);
  const out = descriptionLede(raw);
  assert.ok(out.length <= 201, `expected <=201 chars, got ${out.length}`);
  assert.ok(out.endsWith("…"), "expected a truncated preview to end with an ellipsis");
  assert.ok(!out.slice(0, -1).endsWith(" "), "should not leave a trailing space before the ellipsis");
});

test("strips residual HTML before building the lede", () => {
  assert.equal(descriptionLede("<p>We build <strong>reliable</strong> systems.</p>"), "We build reliable systems.");
});

test("returns empty string for null/empty input", () => {
  assert.equal(descriptionLede(null), "");
  assert.equal(descriptionLede(""), "");
});
