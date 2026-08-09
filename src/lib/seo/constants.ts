import { CORPUS_SOURCE_DESCRIPTOR } from "@/lib/marketing-stats";

/**
 * Single source of truth for the site's canonical origin + display name.
 *
 * Before this file, `SITE_URL` was independently declared in `layout.tsx`,
 * `sitemap.ts`, and `robots.ts` (three copies of the same literal). This
 * consolidates all of them — including `robots.ts`, which now imports this
 * export instead of holding its own copy — onto one export.
 *
 * Driven by `NEXT_PUBLIC_SITE_URL` (falling back to the intervu.cc default)
 * so the canonical domain can move to intervuhq.com later via env var alone,
 * with no code change. Unset today: this is a no-op until that migration.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://intervu.cc";

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
