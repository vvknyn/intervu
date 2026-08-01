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

export function companyPagePath(company: string): string {
  return `/companies/${encodeURIComponent(company)}`;
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
