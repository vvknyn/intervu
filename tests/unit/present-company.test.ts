import { test } from "node:test";
import assert from "node:assert/strict";
import { presentCompany } from "../../src/lib/presentation/company";

test("passes an ATS tenant-code-prefixed, dual-legal-name string through unchanged (audit example — known gap, see company.ts doc)", () => {
  // `displayCompanyBrand` doesn't clean this shape today (verified, not
  // assumed) and `presentCompany` deliberately adds no new name-cleaning
  // rule of its own — see company.ts's "KNOWN GAP" doc comment for why.
  const out = presentCompany({ name: "CAN 3M Canada Company - Compagnie 3M Canada", domain: "3m.com" });
  assert.equal(out.name, "CAN 3M Canada Company - Compagnie 3M Canada");
  assert.equal(out.domain, "3m.com");
});

test("strips an ATS-portal-hostname company placeholder via displayCompanyBrand (composition, not reimplementation)", () => {
  const out = presentCompany({ name: "acme.workable.com", domain: "acme.com" });
  assert.equal(out.name, "Acme");
});

test("falls back to a humanized domain when name is empty", () => {
  const out = presentCompany({ name: "", domain: "acme.workable.com" });
  assert.equal(out.name, "Acme");
});

test("falls back to 'Unknown company' when there is neither a name nor a domain", () => {
  const out = presentCompany({ name: null, domain: null });
  assert.equal(out.name, "Unknown company");
  assert.equal(out.domain, null);
});

test("passes a clean name through unchanged", () => {
  const out = presentCompany({ name: "Acme Robotics", domain: "acme.com" });
  assert.equal(out.name, "Acme Robotics");
});

test("strips a comma-separated legal suffix via displayCompanyBrand (composition)", () => {
  const out = presentCompany({ name: "ServiceTitan, Inc.", domain: "servicetitan.com" });
  assert.equal(out.name, "ServiceTitan");
});

// End-to-end proof the prose-company-names fix (presentation.ts's
// `stripLegalTail`) reaches the ACTUAL production row/detail-pane path —
// `presentCompany` is what `presentJob` (lib/presentation/job.ts) calls for
// every job row and the JobDetail panel, via `displayCompanyBrand`.
test("prose-safe display reaches the real row/detail-pane path: a stacked geography+legal-tail name renders as its brand", () => {
  const out = presentCompany({ name: "Michael Kors (Canada) Holdings LTD", domain: "michaelkors.com" });
  assert.equal(out.name, "Michael Kors");
});
