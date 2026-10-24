/**
 * Reversible company-name ↔ URL slug encoding for `/companies/[slug]` (the
 * per-company truth page — live roles, ghost mix, posting freshness).
 *
 * Distinct from `lib/boards/slug.ts`'s `domainToSlug`/`decodeSlug`, which key
 * `/co/[slug]` off a curated board DOMAIN and only round-trip allowlisted
 * domains. This page is keyed off the raw `company` display string from the
 * jobs corpus and must round-trip ANY company name — spaces, "&", unicode,
 * even incidental leading/trailing whitespace — not just a curated set.
 *
 * Scheme: plain `encodeURIComponent`/`decodeURIComponent`, no normalization.
 * Keeping this a pure mechanical inverse (no trim, no case-fold) is
 * deliberate — cleaning/normalizing a company name for lookup purposes is a
 * SEPARATE concern (company-stats.ts's job), and piggybacking it here would
 * mean the encode step could silently disagree with the decode step about
 * what "the same name" means.
 */
import { domainToSlug } from "@/lib/boards/slug";
import { isCompanyDomain } from "@/lib/jobs/presentation";

export function companyPagePath(company: string): string {
  return `/companies/${encodeURIComponent(company)}`;
}

/**
 * Canonical company link for a job's company reference (P1C consolidation,
 * 2026-08-01): `/co/[slug]` (domain-keyed) is the ONE company surface;
 * `/companies/[slug]` is only a resolver for companies with no known
 * domain (see `company-stats.ts`'s `dominantCompanyDomain` /
 * `page.tsx`'s redirect). A job carrying a `company_domain` therefore
 * links straight to `/co/`, skipping the resolver hop; a domain-less job
 * falls back to the name-keyed path, as does one whose domain is an ATS or vendor host (no company page). Uses `domainToSlug` unmodified — same
 * normalization (trim + lowercase) every other `/co/[slug]` caller
 * (get-company.ts, hot-list.ts, app/page.tsx) already applies; adding a
 * second one here would risk disagreeing with it.
 */
export function jobCompanyHref(company: string, companyDomain: string | null): string {
  const domain = companyDomain?.trim();
  return domain && isCompanyDomain(domain) ? companyBoardPath(domain) : companyPagePath(company);
}

/**
 * The one builder for a `/co/[slug]` path, domain in. Added because the page
 * itself now emits a self-referencing `rel="canonical"` while `sitemap.ts`
 * emits the absolute form of the same URL: a canonical that disagrees with
 * the sitemap entry by so much as a prefix is worse than no canonical, so
 * both derive from this rather than from two hand-written templates. Applies
 * `domainToSlug` unmodified — the same trim+lowercase every other `/co/`
 * caller already uses.
 */
export function companyBoardPath(domain: string): string {
  return `/co/${domainToSlug(domain)}`;
}

/**
 * Mechanical inverse of `companyPagePath`.
 *
 * Next.js's own router decodes a dynamic route segment once before
 * populating `params.slug` (confirmed in `route-matcher.js` /
 * `decode-path-params.js`) — so a page calling this on `params.slug` is
 * decoding an ALREADY-decoded value, while a caller working off a raw slug
 * string pulled straight from a URL (sitemap generation, tests, a link built
 * elsewhere) needs the real decode. Both call sites use this one function
 * (mirrors the `/co/[slug]` convention of always routing `params.slug`
 * through the paired `fromSlug` decoder), so it has to tolerate both inputs:
 * decoding an already-plain name is a harmless no-op UNLESS that name
 * happens to contain a literal "%" that isn't a valid escape (e.g. a company
 * literally named "50% Raise Co"), which would otherwise throw — caught here
 * and returned as-is, since a value decodeURIComponent can't parse further
 * is already the final name.
 */
export function companyFromSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}
