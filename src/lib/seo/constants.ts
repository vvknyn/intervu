import { CORPUS_SOURCE_DESCRIPTOR } from "@/lib/marketing-stats";

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

/** Landing (`/`) metadata — what every search result, browser tab, and
 *  shared-link preview shows. Job-seeker language only; the guest-copy
 *  jargon test bans machinery terms here. Agent/OpenClaw copy belongs to
 *  the opted-in surfaces (/connect, /openclaw). */
export const LANDING_TITLE = "Intervu — live jobs, checked for ghost postings";
export const LANDING_DESCRIPTION = `Every listing is ${CORPUS_SOURCE_DESCRIPTOR} — so you stop wasting applications on roles that were never real.`;

/** Site-wide default meta description (root layout). Declared here — not in
 *  layout.tsx — so the jargon test covers every guest meta string in one
 *  place. */
export const SITE_DESCRIPTION =
    "Search live roles — flagged for ghost-job risk before you spend time on them.";
