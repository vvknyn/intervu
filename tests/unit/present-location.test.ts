import { test } from "node:test";
import assert from "node:assert/strict";
import { locationSummary } from "../../src/lib/presentation/location";

// --- Rule 1: strip a trailing postal code ---------------------------------

test("strips a trailing Canadian postal code (audit example)", () => {
  assert.equal(locationSummary("Waterloo, Ontario, CAN, N2L 0A1"), "Waterloo, Ontario, CAN");
});

test("strips a trailing US ZIP code (class case, not the audit example)", () => {
  assert.equal(locationSummary("Austin, TX, 78701"), "Austin, TX");
});

test("strips a trailing US ZIP+4 code", () => {
  assert.equal(locationSummary("Austin, TX, 78701-1234"), "Austin, TX");
});

test("strips a trailing UK-style postcode", () => {
  assert.equal(locationSummary("London, UK, SW1A 1AA"), "London, UK");
});

// --- Rule 2: collapse a repeated/refining breadcrumb segment --------------

test("collapses an ATS breadcrumb repeating the city (class case, not the audit example)", () => {
  assert.equal(locationSummary("Austin, Austin, TX"), "Austin, TX");
});

test("collapses a breadcrumb repeating a segment case-insensitively", () => {
  assert.equal(locationSummary("berlin, Berlin, Germany"), "berlin, Germany");
});

// --- Rule 3: >3 distinct segments summarize to "first +N more" -----------

test("summarizes a long ATS breadcrumb dump (audit example)", () => {
  assert.equal(
    locationSummary("Toronto, ON, CAN, AMER - Canada - British Columbia - Vancouver - Bentall Centre"),
    "Toronto +7 more",
  );
});

test("summarizes any long breadcrumb, not just the audit's Toronto one", () => {
  assert.equal(locationSummary("Berlin, Germany, EMEA, HQ, Building 3"), "Berlin +4 more");
});

test("keeps a 3-segment location intact (boundary — not yet a summary)", () => {
  assert.equal(locationSummary("Waterloo, Ontario, CAN"), "Waterloo, Ontario, CAN");
});

// --- Rule 4: an all "Remote - XX" US-state list collapses -----------------

test("collapses a long remote-state list to 'Remote (US)' (audit shape: 40 states)", () => {
  const states = ["AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA"];
  const raw = states.map((s) => `Remote - ${s}`).join("; ");
  assert.equal(locationSummary(raw), "Remote (US)");
});

test("collapses a short remote-state list too (class case, not just 40 states)", () => {
  assert.equal(locationSummary("Remote - NY; Remote - NJ; Remote - CT"), "Remote (US)");
});

test("does not collapse a single 'Remote - XX' entry (no list to summarize)", () => {
  assert.equal(locationSummary("Remote - AZ"), "Remote - AZ");
});

// --- Passthrough / edge cases ----------------------------------------------

test("returns empty string for null/empty input", () => {
  assert.equal(locationSummary(null), "");
  assert.equal(locationSummary(""), "");
});

test("leaves a plain two-segment location untouched", () => {
  assert.equal(locationSummary("Austin, TX"), "Austin, TX");
});

test("leaves a single-word location untouched", () => {
  assert.equal(locationSummary("Remote"), "Remote");
});
