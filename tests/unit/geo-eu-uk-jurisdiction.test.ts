import { test } from "node:test";
import assert from "node:assert/strict";
import { isEuOrUkIso2 } from "../../src/lib/geo/eu-uk-jurisdiction";

/**
 * Pure jurisdiction check backing the telemetry client's `visitor_id`
 * storage rule (SPEC.md §5) — a wrong answer here is a legal-risk bug, not
 * a UX one, so it's covered directly rather than only through the client
 * wiring that calls it.
 */

test("an EU member state resolves true", () => {
  assert.equal(isEuOrUkIso2("DE"), true);
  assert.equal(isEuOrUkIso2("FR"), true);
});

test("the UK resolves true even though it is not an EU member", () => {
  assert.equal(isEuOrUkIso2("GB"), true);
});

test("a non-EU/UK country resolves false", () => {
  assert.equal(isEuOrUkIso2("US"), false);
  assert.equal(isEuOrUkIso2("IN"), false);
});

test("lowercase input is folded the same as uppercase", () => {
  assert.equal(isEuOrUkIso2("de"), true);
  assert.equal(isEuOrUkIso2("gb"), true);
});

test("an EEA-but-not-EU state (Norway) resolves true", () => {
  // The case that motivated widening past EU_MEMBERS: GDPR-equivalent
  // protection covers the EEA, not just EU membership.
  assert.equal(isEuOrUkIso2("NO"), true);
});

test("a non-EU, non-EEA European country resolves false", () => {
  // Switzerland: geographically European, but neither EU nor EEA — the
  // boundary assertion proving "add more countries" stops somewhere.
  assert.equal(isEuOrUkIso2("CH"), false);
});

test("an unresolved region (null) is NOT treated as EU/UK by this function", () => {
  // The conservative "unknown -> treat as EU/UK" fallback is a caller
  // decision (the /api/geo/region route, the client's resolveEuUk) — this
  // function only answers "is this SPECIFIC code EU/UK", so null must not
  // silently read as true here.
  assert.equal(isEuOrUkIso2(null), false);
});
