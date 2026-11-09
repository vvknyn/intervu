import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import nextConfig from "../../next.config";
import { HOME_PATH } from "../../src/lib/home-path";
import { AUTH_GATED_PRODUCT_PREFIXES, hrefForSignedOut, isAuthGatedProductPath } from "../../src/lib/auth/product-routes";

/**
 * Class guard: an internal link must point at the address that answers 200, not
 * at one that redirects. A link through a redirect costs every visitor a round
 * trip and every crawler a hop (AI crawlers follow few), and the logo alone put
 * one on every page: `/` answers 308 to `/jobs`.
 *
 * The redirect sources are read from the real config (`redirects()` in
 * next.config.ts, plus `/`, which src/app/page.tsx redirects), and every `href`,
 * `redirect()` and `router.push()` literal under src/ plus every markdown link in
 * the blog is checked against them. A redirect added to the config later makes
 * this test find the links that still point at it.
 */

type Redirect = { source: string; destination: string; has?: unknown; permanent?: boolean };

async function redirectSources(): Promise<Map<string, string>> {
  const rules = (await nextConfig.redirects!()) as Redirect[];
  const map = new Map<string, string>();
  for (const r of rules) {
    // Rules with a condition (`has`) redirect only some requests; a bare link is not one of them.
    if (r.has || /[:*()]/.test(r.source)) continue;
    map.set(r.source, r.destination);
  }
  map.set("/", HOME_PATH);
  return map;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|md)$/.test(e.name) ? [full] : [];
  });
}

const LINK_PATTERNS: RegExp[] = [
  /\bhref\s*=\s*\{?\s*["'`]([^"'`$]+)["'`]/g,
  /\bhref\s*:\s*["'`]([^"'`$]+)["'`]/g,
  /\b(?:permanentRedirect|redirect)\(\s*["'`]([^"'`$]+)["'`]/g,
  /\brouter\.(?:push|replace)\(\s*["'`]([^"'`$]+)["'`]/g,
  /\]\((\/[^)\s"]*)/g,
];

/** Pure: the internal addresses a file's source links to, without query or fragment. `patterns` narrows the shapes looked at. */
export function internalLinkTargets(src: string, patterns: RegExp[] = LINK_PATTERNS): string[] {
  const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
  return patterns.flatMap((re) => [...code.matchAll(re)].map((m) => m[1]))
    .filter((t) => t.startsWith("/") && !t.startsWith("//"))
    .map((t) => t.split(/[?#]/)[0] || "/");
}

describe("internal links point at final addresses, not at redirects", async () => {
  const sources = await redirectSources();
  const root = join(process.cwd(), "src");
  const offenders = sourceFiles(root).flatMap((file) =>
    internalLinkTargets(readFileSync(file, "utf8"))
      .filter((target) => sources.has(target))
      .map((target) => `${relative(process.cwd(), file)}: "${target}" redirects to ${sources.get(target)}`),
  );

  it("no link, redirect() or router.push() under src/ targets a redirecting address", () => {
    assert.deepEqual(offenders, []);
  });

  it("the check sees the redirects the site really has (control: a check over nothing proves nothing)", () => {
    for (const source of ["/", "/mcp", "/agents", "/applications", "/library", "/prep", "/dashboard", "/packs", "/apply"]) {
      assert.ok(sources.has(source), `${source} should be a known redirect source`);
    }
  });

  it("finds each link shape, and ignores query strings and comments", () => {
    assert.deepEqual(internalLinkTargets('<Link href="/">a</Link>'), ["/"]);
    assert.deepEqual(internalLinkTargets("<a href={'/agents?x=1'}>a</a>"), ["/agents"]);
    assert.deepEqual(internalLinkTargets('{ label: "x", href: "/mcp#top" }'), ["/mcp"]);
    assert.deepEqual(internalLinkTargets('redirect("/prep")'), ["/prep"]);
    assert.deepEqual(internalLinkTargets("router.push('/dashboard')"), ["/dashboard"]);
    assert.deepEqual(internalLinkTargets("See [the page](/library) for more"), ["/library"]);
    assert.deepEqual(internalLinkTargets('// <Link href="/">'), []);
    assert.deepEqual(internalLinkTargets('<a href="https://example.com/">x</a>'), []);
  });

  it("home is the job board, which is where `/` redirects", () => {
    assert.equal(sources.get("/"), HOME_PATH);
    assert.equal(HOME_PATH, "/jobs");
  });
});

describe("a link to a gated page, for a visitor who is not signed in, is the sign-in address", () => {
  it("writes the same next= the middleware writes", () => {
    assert.equal(hrefForSignedOut("/settings"), "/login?next=%2Fsettings");
    assert.equal(hrefForSignedOut("/settings?tab=account"), "/login?next=%2Fsettings%3Ftab%3Daccount");
  });

  it("leaves every public address alone", () => {
    for (const href of ["/jobs", "/resume", "/yours", "/connect", "/pricing", "/jobs?q=nurse"]) {
      assert.equal(hrefForSignedOut(href), href);
    }
  });
});

describe("a page anyone can read does not link to a signed-in page by its own address", () => {
  // `/settings` answers 307 to the sign-in page for a visitor or a crawler. Prose on a public
  // page names it through <AccountSettingsLink> (components/layout/AccountSettingsLink.tsx), which
  // writes the sign-in address until the reader is known to be signed in.
  const appRoot = join(process.cwd(), "src", "app");
  const gatedAreas = AUTH_GATED_PRODUCT_PREFIXES.map((p) => p.replace(/^\//, ""));
  // Only what a reader can click: a server `redirect()` (src/app/account/page.tsx) is not a link.
  const CLICKABLE = [LINK_PATTERNS[0], LINK_PATTERNS[1], LINK_PATTERNS[4]];
  const offenders = sourceFiles(appRoot)
    .filter((file) => !gatedAreas.some((area) => relative(appRoot, file).startsWith(`${area}/`)))
    .flatMap((file) =>
      internalLinkTargets(readFileSync(file, "utf8"), CLICKABLE)
        .filter((target) => isAuthGatedProductPath(target))
        .map((target) => `${relative(process.cwd(), file)}: "${target}" needs sign-in`),
    );

  it("no page outside the gated area links straight to a gated address", () => {
    assert.deepEqual(offenders, []);
  });

  it("the check sees a gated link (control)", () => {
    assert.ok(isAuthGatedProductPath(internalLinkTargets('<Link href="/settings">x</Link>')[0]));
  });
});
