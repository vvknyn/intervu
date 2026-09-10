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
                "(e.g. https://velai.app) in the environment before building " +
                "or running this app."
        );
    }
    return value;
}

/** Matches the established brand casing used throughout existing metadata
 *  (OG siteName, app title default) — see `layout.tsx`. */
export const SITE_NAME = "Velai";

/** Landing (`/`) metadata — what every search result, browser tab, and
 *  shared-link preview shows. Job-seeker language only; the guest-copy
 *  jargon test bans machinery terms here. Agent/OpenClaw copy belongs to
 *  the opted-in surfaces (/connect, /openclaw). */
export const LANDING_TITLE =
    "Velai — Live Jobs from Company Career Pages | Verified & Ghost-Screened";
export const LANDING_DESCRIPTION =
    "Search live jobs pulled directly from employer career pages — software, healthcare, trades, and more. Every role is screened for freshness, salary transparency, and ghost-job risk before you apply.";

/** Site-wide default meta description (root layout). Declared here — not in
 *  layout.tsx — so the jargon test covers every guest meta string in one
 *  place. */
export const SITE_DESCRIPTION =
    "Search live, verified remote and tech jobs directly from company career pages. Every role is screened for freshness, salary transparency, and ghost-job risk — the transparent alternative to Indeed and LinkedIn.";

/** Body text for the share primitive (components/ui/share-action.tsx) — sent
 *  as the native share sheet's `text` and prepended to the clipboard-fallback
 *  copy. Guest-facing (a share recipient is, by definition, logged out), so
 *  the jargon test covers both. */
export const SHARE_JOB_TEXT =
    "Found this on Velai — it pulls jobs straight from company career pages and flags the stale ones before you apply.";
export const SHARE_APP_TEXT =
    "Velai shows live jobs pulled straight from company career pages, and screens each one for ghost-job risk before you apply.";

/** High-intent keywords targeting core job discovery, Google Trends top queries,
 *  remote work, Canada/US markets, tech roles, verified employer postings, and salary transparency. */
export const SITE_KEYWORDS = [
    "jobs",
    "job search",
    "find jobs",
    "best remote jobs",
    "remote work",
    "remote work jobs",
    "remote jobs",
    "work from home jobs",
    "wfh jobs",
    "canada remote jobs",
    "remote jobs canada",
    "remote jobs in canada",
    "remote jobs ontario",
    "remote jobs toronto",
    "remote jobs vancouver",
    "us remote jobs",
    "tech jobs",
    "remote tech jobs",
    "software engineer jobs",
    "remote software engineer jobs",
    "ai jobs",
    "machine learning jobs",
    "data scientist jobs",
    "entry level remote jobs",
    "high paying remote jobs",
    "$150k remote jobs",
    "engineering jobs",
    "product manager jobs",
    "designer jobs",
    "indeed alternative",
    "linkedin alternative",
    "linkedin jobs alternative",
    "better than indeed",
    "job board",
    "job listings",
    "verified jobs",
    "direct employer jobs",
    "no ghost jobs",
    "ghost job detector",
    "salary transparency",
    "live hiring signals",
    "ats job tracker",
    "resume builder",
    "job application tracker",
    "careers",
    "employment",
    "career opportunities",
    "open positions",
    "job openings",
    "company career pages",
    "employer career pages",
    "we're hiring",
    "hiring now",
    "work at",
];

