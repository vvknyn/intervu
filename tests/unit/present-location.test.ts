import { test } from "node:test";
import assert from "node:assert/strict";
import { locationSummary, splitLocationLabel } from "../../src/lib/presentation/location";
import { locationText } from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";

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

// A1 audit defect (2026-09-09 prod screenshot): a raw street address fed
// straight into `locationSummary` still reads as a 4-segment breadcrumb and
// summarizes to "626 Polymoore Drive +3 more" — `locationSummary` itself has
// no notion of a street address, so that's not this module's bug to fix.
// The fix lives upstream: `locationText` (jobs/presentation.ts) runs
// `stripStreetAddress` before handing its output to `locationSummary`, so
// the address never reaches this module as more than 3 segments.
const job = (over: Partial<PublicJob>): PublicJob =>
  ({
    location: null,
    location_city: null,
    location_state: null,
    location_country: null,
    work_type: null,
    ...over,
  }) as PublicJob;

test("a street address still summarizes to '+N more' when read raw, unmediated by locationText", () => {
  assert.equal(
    locationSummary("626 Polymoore Drive, Corunna, ON N0N 1G0, Canada"),
    "626 Polymoore Drive +3 more",
  );
});

test("regression: locationText's sanitised output no longer trips the '+N more' summary", () => {
  const cleaned = locationText(job({ location: "626 Polymoore Drive, Corunna, ON N0N 1G0, Canada" }));
  assert.equal(locationSummary(cleaned), "Corunna, ON, Canada");
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

test("collapses an all-Canadian-province remote list to plain 'Remote', not 'Remote (US)' (false-positive survivor)", () => {
  assert.equal(locationSummary("Remote - ON; Remote - BC"), "Remote");
});

test("does not guess a country for a non-standard or mixed code pair", () => {
  assert.equal(locationSummary("Remote - ZZ; Remote - QQ"), "Remote");
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

// --- splitLocationLabel: which part of a value identifies the row ---------
//
// The typeahead row is one truncating line. Whatever sits at its start is
// what a searcher can actually read, so the rule is about WHICH part that is.

test("leads with the site, not the continent — the two prod rows that surfaced this", () => {
  // Both rendered as "North America/USA/Missouri/St. …" and offered different
  // things (24 postings vs 12).
  const ccp = splitLocationLabel("North America/USA/Missouri/St. Louis - CCP");
  const wpe = splitLocationLabel("North America/USA/Missouri/St. Louis - WPE");
  assert.equal(ccp.lead, "St. Louis - CCP");
  assert.equal(wpe.lead, "St. Louis - WPE");
  assert.notEqual(ccp.lead, wpe.lead, "the whole point: the leads must differ");
  assert.equal(ccp.context, "North America / USA / Missouri");
});

test("the rule is the shape, not those rows — any 3+ level path splits the same way", () => {
  assert.deepEqual(splitLocationLabel("Europe/GRE/Markopoulo"), {
    lead: "Markopoulo",
    context: "Europe / GRE",
  });
  assert.deepEqual(splitLocationLabel("A/B/C/D/E"), { lead: "E", context: "A / B / C / D" });
});

test("tolerates padding and empty levels around the separators", () => {
  assert.deepEqual(splitLocationLabel("North America / USA //  Minnesota / Mankato "), {
    lead: "Mankato",
    context: "North America / USA / Minnesota",
  });
});

test("two slash-joined parts are a name or a pair, never a path", () => {
  // Reversing either of these would lead the row with the wrong word:
  // "Frankfurt/Main" is one city; "Middle East/Africa" is a two-item list.
  assert.deepEqual(splitLocationLabel("Frankfurt/Main"), { lead: "Frankfurt/Main", context: "" });
  assert.deepEqual(splitLocationLabel("Middle East/Africa"), { lead: "Middle East/Africa", context: "" });
});

test("does not reverse the delimiters whose direction is not reliable", () => {
  // A comma list is conventionally narrow-first, and a spaced dash goes both
  // ways in this corpus ("Toronto - Bay St" vs "APAC - Malaysia - Seoul").
  for (const raw of ["Toronto, Ontario, Canada", "APAC - Malaysia - Kuala Lumpur", "Toronto - Bay St"]) {
    assert.deepEqual(splitLocationLabel(raw), { lead: raw, context: "" }, raw);
  }
});

test("a plain place is returned whole, so every row renders through one shape", () => {
  assert.deepEqual(splitLocationLabel("Toronto"), { lead: "Toronto", context: "" });
  assert.deepEqual(splitLocationLabel(""), { lead: "", context: "" });
});
