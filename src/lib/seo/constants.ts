import { CORPUS_SOURCE_DESCRIPTOR } from "@/lib/marketing-stats";

/**
 * Single source of truth for the site's canonical origin + display name.
 *
 * Before this file, `SITE_URL` was independently declared in `layout.tsx`,
 * `sitemap.ts`, and `robots.ts` (three copies of the same literal). This
 * consolidates all of them — including `robots.ts`, which now imports this
 * export instead of holding its own copy — onto one export.
 *
 * Driven entirely by `NEXT_PUBLIC_SITE_URL` — there is NO fallback domain.
 * `intervu.cc` is a retired domain that now only 301s to intervuhq.com; a
 * silent fallback to it would emit canonical/OG/sitemap/JSON-LD URLs
 * pointing at a domain that never serves real content — wrong and invisible
 * until rankings suffer. `getSiteUrl()` throws a clear error naming the
 * missing var instead of guessing.
 *
 * Deliberately a function, not a top-level `const`: it's called lazily by
 * each real consumer (layout.tsx, sitemap.ts, robots.ts, jsonld.ts,
 * page-metadata.ts), so importing this module for an unrelated export
 * (`SITE_NAME`, `LANDING_TITLE`, ...) never requires `NEXT_PUBLIC_SITE_URL`
 * to be set.
 */
export function getSiteUrl(): string {
    const value = process.env.NEXT_PUBLIC_SITE_URL;
    if (!value) {
        throw new Error(
            "NEXT_PUBLIC_SITE_URL is not set. Canonical URLs, sitemap.xml, " +
                "robots.txt, and JSON-LD all derive the site's origin from this " +
                "env var — there is no fallback domain. Set NEXT_PUBLIC_SITE_URL " +
                "(e.g. https://intervuhq.com) in the environment before building " +
                "or running this app."
        );
    }
    return value;
}

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
