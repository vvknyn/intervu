import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { getSiteUrl, SITE_NAME } from "@/lib/seo/constants";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

/**
 * `getSiteUrl()` re-reads `process.env.NEXT_PUBLIC_SITE_URL` on every call —
 * no module-scope caching, unlike the old `SITE_URL` constant this replaced
 * (see the docstring in src/lib/seo/constants.ts). That means, unlike the
 * env-seam tests this file used to need, a same-process mutation of
 * `process.env` before each call is observed immediately — no subprocess
 * isolation required. `robots.ts`/`sitemap.ts` export plain functions too
 * (not invoked at import time), so importing them doesn't require the var
 * either; only actually calling `getSiteUrl()`/`robots()`/`sitemap()` does.
 */
describe("seo/constants — getSiteUrl() env seam", () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_ENV;
  });

  it("honors NEXT_PUBLIC_SITE_URL when set", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";
    assert.equal(getSiteUrl(), "https://intervuhq.com");
  });

  it("throws a clear error naming NEXT_PUBLIC_SITE_URL when unset", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.throws(() => getSiteUrl(), /NEXT_PUBLIC_SITE_URL is not set/);
  });

  // Distinct from "unset" — a blank env var (e.g. left blank by a
  // misconfigured deploy) must be rejected the same way, not treated as "set".
  it("throws the same error when set to an empty string", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "";
    assert.throws(() => getSiteUrl(), /NEXT_PUBLIC_SITE_URL is not set/);
  });

  // The core reason getSiteUrl() is a function rather than a top-level
  // `const`: importing this module for an export that has nothing to do
  // with the site origin must never require NEXT_PUBLIC_SITE_URL to be set.
  it("does not require NEXT_PUBLIC_SITE_URL just to import an unrelated export", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(SITE_NAME, "Intervu");
  });

  // robots.ts/sitemap.ts used to declare their own local
  // `const SITE_URL = "https://intervu.cc"` — a duplicate that could
  // silently drift from the real one. These assert against the actually
  // imported `getSiteUrl()` (not a hardcoded literal), so they'd fail if
  // that duplicate ever came back.
  it("robots.ts derives host and sitemap from the shared getSiteUrl(), not a hardcoded duplicate", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";
    const siteUrl = getSiteUrl();
    const result = robots();
    assert.equal(result.host, siteUrl);
    assert.equal(result.sitemap, `${siteUrl}/sitemap.xml`);
  });

  it("sitemap.ts derives every entry's URL from the shared getSiteUrl()", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";
    const siteUrl = getSiteUrl();
    const result = sitemap();
    assert.ok(result.length > 0);
    for (const entry of result) {
      assert.ok(entry.url.startsWith(`${siteUrl}/`), `expected ${entry.url} to start with ${siteUrl}/`);
    }
  });
});
