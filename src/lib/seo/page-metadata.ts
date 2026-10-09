import type { Metadata } from "next";
import { getSiteUrl, SITE_NAME } from "./constants";

/**
 * Per-page canonical + Open Graph + Twitter URL/title mechanics — the
 * pattern `jobs/layout.tsx` established (#145) for the one route that had
 * it, generalized here so every other indexable static page gets the same
 * fields without hand-copying `alternates.canonical` + `openGraph.url` (and
 * the `${SITE_URL}` interpolation) into each page file. `title`/
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
): Pick<Metadata, "alternates" | "openGraph" | "twitter"> {
  return {
    alternates: { canonical: path },
    openGraph: { title, description, url: `${getSiteUrl()}${path}`, siteName: SITE_NAME, locale: "en_US" },
    twitter: { card: "summary_large_image", title, description },
  };
}
