/**
 * Pure jurisdiction check for the telemetry client's identity-storage rule
 * (SPEC §5): a visitor resolved to the EU or UK must have `visitor_id` held
 * in sessionStorage rather than localStorage until a consent choice exists.
 *
 * Reuses `EU_MEMBERS` (geo/regions.ts) rather than keeping a second copy of
 * the EU country list — that module is already the single source of truth
 * for EU membership (used there for "eu"/"european union" search-phrase
 * resolution). "UK" is added on top since GDPR's client-storage rule
 * post-Brexit still applies to the UK via UK-GDPR, and the underlying
 * membership list has no reason to know about that legal detail.
 */
import { EU_MEMBERS } from "./regions";

const EU_UK_ISO2 = new Set([...EU_MEMBERS, "GB"]);

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
