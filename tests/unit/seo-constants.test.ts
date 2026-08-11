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

  it("sitemap.ts derives every entry's URL from the shared getSiteUrl()", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";
    const siteUrl = getSiteUrl();
    const result = await withStubbedMeili(everyDomainHasRoles, sitemap);
    assert.ok(result.length > 0);
    for (const entry of result) {
      assert.ok(entry.url.startsWith(`${siteUrl}/`), `expected ${entry.url} to start with ${siteUrl}/`);
    }
  });

  // The `/co/` section is now MEASURED (lib/companies/indexable.ts) rather
  // than asserted straight off the board allowlist, so these pin the two
  // outcomes that decide what Google is told.
  it("sitemap.ts omits company pages with too little content to rank", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";
    const withRoles = await withStubbedMeili(everyDomainHasRoles, sitemap);
    const withoutRoles = await withStubbedMeili(noDomainHasRoles, sitemap);

    const coCount = (entries: Awaited<ReturnType<typeof sitemap>>) =>
      entries.filter((e) => e.url.includes("/co/")).length;
    assert.ok(coCount(withRoles) > 0, "expected company pages when every domain has roles");
    assert.equal(coCount(withoutRoles), 0, "expected no company pages when none have roles");
    // The static, always-indexable pages are unaffected either way.
    assert.equal(withRoles.length - coCount(withRoles), withoutRoles.length);
  });

  it("sitemap.ts FAILS rather than silently publishing an empty /co/ section", async () => {
    // A Meilisearch outage must not be reportable to Google as "we removed
    // those 442 pages". A throw becomes a 5xx, which search engines already
    // treat as "retry later, keep the last good copy". See sitemap.ts's
    // failure-posture docblock.
    process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";
    await assert.rejects(
      () => withStubbedMeili(() => new Response("boom", { status: 500 }), sitemap),
      /multi-search failed/i,
    );
  });
});

/** Meilisearch `/multi-search` reply giving every requested domain enough
 *  live roles to clear the gate. Echoes the request's own domains back, so it
 *  exercises the real chunking in `fetchLiveRoleCountsByDomain`. */
function everyDomainHasRoles(body: string): Response {
  const { queries } = JSON.parse(body) as { queries: { filter: string[] }[] };
  const results = queries.map((q) => {
    const domains = [...(q.filter.join(" ").matchAll(/"([^"]+\.[^"]+)"/g))].map((m) => m[1]);
    return {
      facetDistribution: { company_domain: Object.fromEntries(domains.map((d) => [d, 25])) },
    };
  });
  return Response.json({ results });
}

/** Same, but the index knows of no live roles for any of them. */
function noDomainHasRoles(body: string): Response {
  const { queries } = JSON.parse(body) as { queries: unknown[] };
  return Response.json({ results: queries.map(() => ({ facetDistribution: { company_domain: {} } })) });
}

/**
 * Runs `fn` with `fetch` and `MEILISEARCH_HOST` stubbed. `sitemap()` reaches
 * Meilisearch through the shared `meiliFetch` chokepoint, so stubbing the
 * transport keeps these hermetic while still running the real query-building,
 * chunking and facet-parsing code.
 */
async function withStubbedMeili<T>(reply: (body: string) => Response, fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const realHost = process.env.MEILISEARCH_HOST;
  process.env.MEILISEARCH_HOST = "http://meili.test";
  globalThis.fetch = (async (_url: string, init: RequestInit) =>
    reply(String(init.body))) as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    if (realHost === undefined) delete process.env.MEILISEARCH_HOST;
    else process.env.MEILISEARCH_HOST = realHost;
  }
}
