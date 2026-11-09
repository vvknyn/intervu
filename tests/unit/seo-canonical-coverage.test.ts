import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { indexabilityFor } from "../../src/lib/seo/indexability";

/**
 * Class guard: every page the indexability policy lets search engines index must
 * name itself with a self-referencing canonical (or visibly opt out with its own
 * noindex). A page that does neither leaves the crawler to guess which of its
 * addresses (with or without a query, a trailing slash, a tracking parameter) is
 * the real one, and the guess splits its ranking. /openclaw was exactly that: 200,
 * indexable, no canonical.
 *
 * The routes come from the page files, so a page added tomorrow is held to it.
 */

const APP = join(process.cwd(), "src", "app");

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return pageFiles(full);
    return e.name === "page.tsx" ? [full] : [];
  });
}

/** The URL path a page file answers, with each `[param]` replaced by a sample value. */
export function routeOf(file: string): string {
  const parts = relative(APP, file).split(sep).slice(0, -1).map((p) => (/^\[.+\]$/.test(p) ? "sample" : p));
  return `/${parts.join("/")}`;
}

/** Builders that put `alternates.canonical` in a page's metadata. */
const CANONICAL_SOURCES = /canonicalMetadata\(|buildJobsMetadata\(|buildCompanyPageMetadata\(|alternates\s*:/;
/** A page that says, in its own metadata, that it is not to be indexed. */
const OWN_NOINDEX = /robotsMetadataFor\(|robots\s*:\s*\{/;
/** A page that only redirects renders nothing a search engine would index. */
const REDIRECT_ONLY = (src: string) => /(?:permanentRedirect|redirect)\(/.test(src) && !/return\s*\(?\s*</.test(src);

/** Pure: whether a page's source takes care of its own canonical (or its own noindex). */
export function namesItself(src: string): boolean {
  return CANONICAL_SOURCES.test(src) || OWN_NOINDEX.test(src) || REDIRECT_ONLY(src);
}

describe("every indexable page names its canonical", () => {
  const pages = pageFiles(APP).map((file) => ({ file, route: routeOf(file), src: readFileSync(file, "utf8") }));

  it("the scan finds the site's pages (control: a scan that finds nothing proves nothing)", () => {
    const routes = pages.map((p) => p.route);
    for (const route of ["/about", "/pricing", "/blog/sample", "/openclaw", "/jobs"]) assert.ok(routes.includes(route), route);
  });

  it("no page the policy indexes is left without a canonical", () => {
    const offenders = pages
      .filter(({ route }) => indexabilityFor(route).index)
      .filter(({ src }) => !namesItself(src))
      .map(({ route }) => route);
    assert.deepEqual(offenders, []);
  });

  it("a literal canonical names the page's own address, never another", () => {
    const wrong = pages.flatMap(({ route, src }) =>
      [...src.matchAll(/canonicalMetadata\(\s*["'`]([^"'`$]+)["'`]/g)]
        .map((m) => m[1])
        .filter((path) => path !== route && !route.includes("sample"))
        .map((path) => `${route} canonicalises to ${path}`),
    );
    assert.deepEqual(wrong, []);
  });

  it("recognises each way of naming a canonical, and rejects a bare page", () => {
    assert.ok(namesItself('export const metadata = { ...canonicalMetadata("/x", "t", "d") };'));
    assert.ok(namesItself("export const metadata = buildJobsMetadata();"));
    assert.ok(namesItself("return buildCompanyPageMetadata(data);"));
    assert.ok(namesItself('export const metadata = { alternates: { canonical: "/x" } };'));
    assert.ok(namesItself("export const metadata = { ...robotsMetadataFor('/x') };"));
    assert.ok(namesItself('export default async function P() { redirect("/jobs"); }'));
    assert.ok(!namesItself('export const metadata = { title: "T", description: "D" };\nexport default function P() { return <div/>; }'));
  });
});
