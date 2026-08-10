import type { Metadata } from "next";
import { getSiteUrl } from "./constants";

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
 */
export function canonicalMetadata(
  path: string,
  title: string,
  description: string,
): Pick<Metadata, "alternates" | "openGraph" | "twitter"> {
  return {
    alternates: { canonical: path },
    openGraph: { title, description, url: `${getSiteUrl()}${path}` },
    twitter: { title, description },
  };
}
