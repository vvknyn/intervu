/**
 * `presentCompany`: the one place a raw `{ name, domain }` pair becomes a
 * display-safe company identity.
 *
 * Pure composition over `displayCompanyBrand` (lib/jobs/presentation.ts) —
 * legal-suffix-stripped brand name, falling back to a humanized domain — plus
 * the "Unknown company" fallback JobDetail.tsx currently inlines as its own
 * ternary next to `displayCompanyBrand`'s call. Centralizing that fallback
 * here means wave-3 adoption removes the duplicate rather than keeping two
 * copies of "what do we call a company with no name and no domain". No new
 * name-cleaning rule is added here — see the module doc above for why a
 * parallel implementation of `cleanCompany`'s job would be the wrong move.
 *
 * KNOWN GAP, deliberately left open (audit, 2026-08-20): a raw name like
 * "CAN 3M Canada Company - Compagnie 3M Canada" (a leading bare country-code
 * token, plus a dash-joined duplicate name in a second language) passes
 * through `displayCompanyBrand` UNCHANGED today — verified, not assumed; see
 * ADOPTION.md. Two shapes that could plausibly fix it were both rejected as
 * unsafe/overfit for THIS PR:
 *   - stripping a leading short all-caps token unconditionally collides with
 *     real brand acronyms ("IBM Global Services" would lose "IBM" — the
 *     exact false-positive class already documented against `cleanCompany`'s
 *     own design, memory: shape-predicates-overstate-data-quality-bugs).
 *   - collapsing a dash-joined "duplicate" segment needs to PROVE duplication
 *     (`cleanCompany`'s own parenthetical strip does this via a token-subset
 *     check) — the French segment's tokens are not a subset of the English
 *     one's, so the same safe test that already guards `cleanCompany`
 *     correctly refuses to strip it, and a looser test would be exactly the
 *     one-example-shaped rule the lean-code standard rules out.
 * Left for a follow-up validated against the wider corpus, not invented here
 * against a single string.
 */
import { displayCompanyBrand } from "@/lib/jobs/presentation";

/** The minimal shape `presentCompany` needs — a subset any pipeline row
 *  (`PublicJob`, `CompanyPageData`, an email-digest row) already carries,
 *  so callers pass their own object through without an adapter. */
export interface CompanyLikeInput {
  name?: string | null;
  domain?: string | null;
}

export interface PresentedCompany {
  name: string;
  domain: string | null;
}

const UNKNOWN_COMPANY = "Unknown company";

export function presentCompany(input: CompanyLikeInput): PresentedCompany {
  const domain = input.domain ?? null;
  return {
    name: displayCompanyBrand(input.name, domain) || UNKNOWN_COMPANY,
    domain,
  };
}
