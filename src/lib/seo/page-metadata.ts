import type { Metadata } from "next";
import { getSiteUrl, SITE_NAME } from "./constants";

/** Longest title (brand included) worth showing in a result; optional trailing parts are dropped to fit. */
export const TITLE_BUDGET = 60;

const BRAND_RE = new RegExp(`\\b${SITE_NAME}\\b`, "i");

/**
 * The one place a page title gets its brand: parts joined with " — ", the
 * brand appended once (unless the text already names it), and trailing parts
 * dropped while the result is over `TITLE_BUDGET`. The first part is never
 * dropped. The root layout's `title.template` is NOT relied on, so og:title,
 * twitter:title and <title> all carry the same string.
 */
export function pageTitle(...parts: (string | null | undefined | false)[]): string {
  const kept = parts.map((p) => (p ? p.trim() : "")).filter(Boolean);
  const render = (n: number) => {
    const text = kept.slice(0, n).join(" — ");
    return BRAND_RE.test(text) ? text : `${text} · ${SITE_NAME}`;
  };
  if (kept.length === 0) return SITE_NAME;
  let n = kept.length;
  while (n > 1 && render(n).length > TITLE_BUDGET) n--;
  return render(n);
}

/**
 * Per-page canonical + Open Graph + Twitter URL/title mechanics — the
 * pattern `jobs/layout.tsx` established (#145) for the one route that had
 * it, generalized here so every other indexable static page gets the same
 * fields without hand-copying `alternates.canonical` + `openGraph.url` (and
 * the `${SITE_URL}` interpolation) into each page file. `title` (bare, brand added by `pageTitle`) and
 * `description` are the page's own existing copy — this only adds the URL
 * mechanics `metadataBase` alone doesn't give a nested route: without an
 * explicit `alternates.canonical` and `openGraph.url`, a subpage inherits
 * the root layout's homepage og:url and generic site title.
 *
 * Next merges metadata shallowly, so a page's `openGraph`/`twitter` replace
 * the root layout's whole objects. The site name, locale and large-picture
 * card are repeated here or every subpage would lose them. No picture is
 * set here: an `images` entry would win over a route's own opengraph-image
 * file (trends, jobs/[slug]), so a page that needs one passes its own.
 */
export function canonicalMetadata(
  path: string,
  title: string,
  description: string,
): Pick<Metadata, "title" | "alternates" | "openGraph" | "twitter"> {
  const branded = pageTitle(title);
  return {
    title: { absolute: branded },
    alternates: { canonical: path },
    openGraph: { title: branded, description, url: `${getSiteUrl()}${path}`, siteName: SITE_NAME, locale: "en_US" },
    twitter: { card: "summary_large_image", title: branded, description },
  };
}
