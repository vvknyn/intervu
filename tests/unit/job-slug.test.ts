import assert from "node:assert/strict";
import { test } from "node:test";
import { jobPath, parseJobSlug } from "../../src/lib/jobs/job-slug";

const UUID = "f7357d0c-fae4-4f2e-a850-c46d991efba3";

test("builds a readable path ending in the uuid", () => {
  assert.equal(
    jobPath({ id: UUID, title: "Data Engineer", company: "orange" }),
    `/jobs/data-engineer-at-orange-${UUID}`,
  );
});

test("omits the company segment when company is null", () => {
  assert.equal(jobPath({ id: UUID, title: "Data Engineer", company: null }), `/jobs/data-engineer-${UUID}`);
});

test("parses the uuid off the tail", () => {
  assert.equal(parseJobSlug(`data-engineer-at-orange-${UUID}`), UUID);
});

// The class of bug this guards, not just the instance: a title that itself
// contains a uuid-shaped run must not confuse the parser.
test("takes the TRAILING uuid when the slug body also contains one", () => {
  assert.equal(parseJobSlug(`migrate-${UUID}-job-${UUID}`), UUID);
});

test("rejects a slug with no uuid", () => {
  assert.equal(parseJobSlug("data-engineer-at-orange"), null);
});

test("rejects a bare uuid with trailing junk", () => {
  assert.equal(parseJobSlug(`${UUID}-`), null);
});

test("strips unicode and punctuation from titles", () => {
  assert.equal(
    jobPath({ id: UUID, title: "Señor C++ Dev (Remote!)", company: "Acme, Inc." }),
    `/jobs/senor-c-dev-remote-at-acme-inc-${UUID}`,
  );
});

test("resolves a bare uuid (no descriptive prefix) — old /jobs/<uuid> links stay valid", () => {
  assert.equal(parseJobSlug(UUID), UUID);
});
