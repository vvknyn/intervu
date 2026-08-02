/**
 * Single source of truth for the site's canonical origin + display name.
 *
 * Before this file, `SITE_URL` was independently declared in `layout.tsx`,
 * `sitemap.ts`, and `robots.ts` (three copies of the same literal). This
 * consolidates the two we own in this SEO pass (`layout.tsx`, `sitemap.ts`)
 * plus the new JSON-LD builders onto one export rather than adding a fourth
 * copy. `robots.ts` is out of scope for this change (owned by another lane)
 * so its copy is left as-is.
 */
export const SITE_URL = "https://intervu.cc";

/** Matches the established brand casing used throughout existing metadata
 *  (OG siteName, app title default) — see `layout.tsx`. */
export const SITE_NAME = "Intervu";
