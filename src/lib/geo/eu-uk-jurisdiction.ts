/**
 * SPEC.md is not in this repo — see docs/telemetry/SPEC-PROVENANCE.md.
 *
 * Pure jurisdiction check for the telemetry client's identity-storage rule
 * (SPEC §5): a visitor resolved to somewhere GDPR-equivalent protection
 * applies must have `visitor_id` held in sessionStorage rather than
 * localStorage until a consent choice exists.
 *
 * This is a DIFFERENT question than "EU_MEMBERS" (geo/regions.ts) answers.
 * `EU_MEMBERS` is the right base — reused here rather than kept as a second
 * copy that could drift — but it's a MEMBERSHIP list (27 EU states, used
 * there for "eu"/"european union" search-phrase resolution), not a
 * jurisdiction list: GDPR-equivalent protection also covers the UK
 * (post-Brexit, via UK-GDPR) and the rest of the EEA that was never in the
 * EU — Norway, Iceland, Liechtenstein. That legal delta (membership +
 * UK-GDPR + EEA-only states) belongs HERE, precisely because `regions.ts`
 * has no reason to know about it — widening `EU_MEMBERS` itself would
 * wrongly pull Norway into EU search-phrase resolution too.
 */
import { EU_MEMBERS } from "./regions";

const EU_UK_ISO2 = new Set([...EU_MEMBERS, "GB", "NO", "IS", "LI"]);

/** `iso2` is a country code as returned by the mmdb country lookup
 *  (geo/ip-country.ts) — uppercase ISO 3166-1 alpha-2, or `null` when the
 *  IP couldn't be resolved to a country at all. A `null`/unrecognized code
 *  is NOT treated as EU/UK here — this function is the class-wide decision
 *  only; callers that need to fail closed on an unresolved region (the
 *  conservative default when the legal question can't be answered) decide
 *  that separately, since "unknown" and "known non-EU/UK" are different
 *  facts this function shouldn't conflate. */
export function isEuOrUkIso2(iso2: string | null): boolean {
  return iso2 !== null && EU_UK_ISO2.has(iso2.toUpperCase());
}
