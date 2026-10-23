import type { Metadata, MetadataRoute } from "next";
import type { CompanyIndexability } from "@/lib/companies/indexable";

/**
 * THE indexability policy: the one place that decides, for a URL, whether it
 * may be indexed, whether its links are followed, which URL is its canonical
 * and whether it belongs in /sitemap.xml. Everything that used to decide this
 * on its own now derives from {@link indexabilityFor}:
 *
 *   - the `X-Robots-Tag` header          -> {@link robotsHeaderFor} (middleware.ts)
 *   - every page's `robots` metadata      -> {@link robotsMetadataFor}
 *   - the robots.txt disallow lists       -> {@link PRIVATE_PATHS}, {@link JOB_PATH_PREFIXES},
 *                                            {@link QUERY_DISALLOW_PATTERNS} (shield/robots-policy.ts)
 *   - the sitemap's static entries        -> {@link SITEMAP_PAGES}
 *
 * Standing rulings encoded here: job pages (`/jobs/<id>`) stay noindex,nofollow
 * and out of the sitemap; any URL carrying a query string stays out of the
 * index (robots.txt keeps its Disallow, so the noindex meta/header exist as the
 * second signal and the first never has to be relied on alone).
 *
 * Pure and dependency-light on purpose: middleware imports it, so it must not
 * pull in content (blog posts, hubs) or the search client. Company pages need
 * their measured counts, so the caller passes the already-resolved
 * {@link CompanyIndexability} (type-only import above).
 */

export interface Indexability {
  index: boolean;
  follow: boolean;
  /** Path the page declares as its canonical; null = the page names its own (or none). */
  canonical: string | null;
  inSitemap: boolean;
}

/** Authed/API/private surfaces — never worth crawling regardless of bot.
 *  `/oauth/` covers the MCP OAuth 2.1 AS's authorize/token/consent
 *  endpoints — auth-flow pages carrying state/token query params, never a
 *  marketing surface worth indexing. */
export const PRIVATE_PATHS = ["/api/", "/admin", "/settings", "/account", "/reset-password", "/oauth/"];

/** Job postings: individually noindex, nofollow (standing ruling). */
export const JOB_PATH_PREFIXES = ["/jobs/", "/job/"];

/** robots.txt patterns for every query-string URL (`/jobs?…`, `?job=…`); the bare
 *  `/?` is robots-policy.ts's own DEEP_SEARCH_DISALLOW_PATTERN. */
export const QUERY_DISALLOW_PATTERNS = ["/*?job=*", "/*?*job*", "/*?q=*", "/?*", "/*?*"];

/** Pages that are not for search results and whose links lead nowhere worth
 *  crawling either. Not in robots.txt (crawlable so the noindex is seen). */
const NOINDEX_NOFOLLOW_PAGES = ["/auth", "/login", "/stories", "/resume", "/watch", "/yours", "/mock"];

/** Pages that must stay out of the index but whose links are real pages. */
const NOINDEX_FOLLOW_PAGES = ["/connect/help", "/companies"];

/** Static marketing pages submitted to /sitemap.xml (hub, blog-post and
 *  company entries are enumerated from their own data in sitemap.ts). */
export const SITEMAP_PAGES: readonly {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
}[] = [
  { path: "/jobs", changeFrequency: "daily", priority: 1 },
  { path: "/trends", changeFrequency: "daily", priority: 0.8 },
  { path: "/connect", changeFrequency: "weekly", priority: 0.7 },
  { path: "/research/ghost-jobs", changeFrequency: "monthly", priority: 0.6 },
  { path: "/indeed-alternative", changeFrequency: "monthly", priority: 0.7 },
  { path: "/linkedin-jobs-alternative", changeFrequency: "monthly", priority: 0.7 },
  { path: "/eluta-alternative", changeFrequency: "monthly", priority: 0.7 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.6 },
  { path: "/about", changeFrequency: "monthly", priority: 0.5 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

const underPath = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);
const underAny = (pathname: string, bases: readonly string[]) =>
  bases.some((base) => underPath(pathname, base.replace(/\/$/, "")));

const NO_INDEX = { index: false, canonical: null, inSitemap: false } as const;
const listed = (path: string): Indexability => ({ index: true, follow: true, canonical: path, inSitemap: true });

function indexabilityForPath(pathname: string, company?: CompanyIndexability): Indexability {
  if (JOB_PATH_PREFIXES.some((p) => pathname.startsWith(p)) || underAny(pathname, [...PRIVATE_PATHS, ...NOINDEX_NOFOLLOW_PAGES])) {
    return { ...NO_INDEX, follow: false };
  }
  if (underAny(pathname, NOINDEX_FOLLOW_PAGES)) return { ...NO_INDEX, follow: true };
  if (underPath(pathname, "/co")) {
    return {
      index: company?.pageIndexable ?? true,
      follow: true,
      canonical: pathname,
      inSitemap: company?.inSitemap ?? false,
    };
  }
  if (SITEMAP_PAGES.some((page) => page.path === pathname) || underPath(pathname, "/blog") || underPath(pathname, "/careers")) {
    return listed(pathname);
  }
  return { index: true, follow: true, canonical: null, inSitemap: false };
}

/** The whole policy. A query string never changes WHERE a page canonicalises,
 *  only that this variant is not itself indexed or submitted. */
export function indexabilityFor(
  pathname: string,
  searchParams?: URLSearchParams,
  company?: CompanyIndexability,
): Indexability {
  const base = indexabilityForPath(pathname, company);
  return searchParams && searchParams.size > 0 ? { ...base, index: false, follow: false, inSitemap: false } : base;
}

/** `X-Robots-Tag` value for a response, or null when the URL is indexable. */
export function robotsHeaderFor(pathname: string, searchParams?: URLSearchParams): string | null {
  const { index, follow } = indexabilityFor(pathname, searchParams);
  return index ? null : `noindex, ${follow ? "follow" : "nofollow"}, noarchive, nosnippet`;
}

/** Spread into a page's `Metadata`. Empty when the page is plainly indexable,
 *  so it inherits the root layout's default (and its richer snippet rules). */
export function robotsMetadataFor(
  pathname: string,
  searchParams?: URLSearchParams,
  company?: CompanyIndexability,
): Pick<Metadata, "robots"> {
  const { index, follow } = indexabilityFor(pathname, searchParams, company);
  return index && follow ? {} : { robots: { index, follow } };
}
