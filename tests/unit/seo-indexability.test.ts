import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { BLOG_PATH } from "@/lib/blog/posts";
import { buildJobsMetadata } from "@/lib/seo/jobs-metadata";
import {
  indexabilityFor,
  JOB_PATH_PREFIXES,
  PRIVATE_PATHS,
  robotsHeaderFor,
  robotsMetadataFor,
  SITEMAP_PAGES,
} from "@/lib/seo/indexability";
import { buildSitemapEntries } from "@/lib/seo/sitemap-entries";
import { buildRobotsRules } from "@/lib/shield/robots-policy";

const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
before(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://velai.test";
});
after(() => {
  if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
});

const JOB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const q = (s: string) => new URLSearchParams(s);
const NOINDEX_NOFOLLOW = { index: false, follow: false, inSitemap: false };

describe("indexabilityFor — one policy for every URL class", () => {
  const rows: [string, string, Partial<ReturnType<typeof indexabilityFor>>][] = [
    ["/jobs", "", { index: true, follow: true, canonical: "/jobs", inSitemap: true }],
    ["/jobs", "q=nurse", { index: false, follow: false, canonical: "/jobs", inSitemap: false }],
    ["/jobs", "location=Toronto&remote=1", { index: false, canonical: "/jobs", inSitemap: false }],
    [`/jobs/engineer-at-acme-${JOB_ID}`, "", { ...NOINDEX_NOFOLLOW, canonical: null }],
    ["/job/legacy", "", NOINDEX_NOFOLLOW],
    ["/pricing", "", { index: true, canonical: "/pricing", inSitemap: true }],
    ["/pricing", "utm_source=x", { index: false, canonical: "/pricing", inSitemap: false }],
    ["/blog", "", { index: true, canonical: "/blog", inSitemap: true }],
    ["/blog/is-velai-legit", "", { index: true, canonical: "/blog/is-velai-legit", inSitemap: true }],
    ["/careers/remote-jobs", "", { index: true, canonical: "/careers/remote-jobs", inSitemap: true }],
    ["/login", "", NOINDEX_NOFOLLOW],
    ["/stories", "", NOINDEX_NOFOLLOW],
    ["/settings", "tab=account", NOINDEX_NOFOLLOW],
    ["/api/mcp", "", NOINDEX_NOFOLLOW],
    // Classes the brief did not name: dev fixtures, OAuth consent, noindex-but-followed pages.
    ["/mock/lockup", "", NOINDEX_NOFOLLOW],
    ["/oauth/authorize", "", NOINDEX_NOFOLLOW],
    ["/yours/history", "", NOINDEX_NOFOLLOW],
    ["/connect/help", "", { index: false, follow: true, inSitemap: false }],
    ["/companies/acme", "", { index: false, follow: true, inSitemap: false }],
    // Unlisted public routes default to indexable but are never submitted.
    ["/some-new-page", "", { index: true, follow: true, canonical: null, inSitemap: false }],
    ["/", "", { index: true, inSitemap: false }],
  ];
  for (const [path, query, expected] of rows) {
    it(`${path}${query ? `?${query}` : ""}`, () => {
      assert.deepEqual({ ...indexabilityFor(path, q(query)) }, { ...indexabilityFor(path, q(query)), ...expected });
    });
  }

  it("/co/<slug> follows the measured company counts the caller resolved", () => {
    assert.deepEqual(indexabilityFor("/co/acme--com", q(""), { pageIndexable: true, inSitemap: true }), {
      index: true, follow: true, canonical: "/co/acme--com", inSitemap: true,
    });
    assert.equal(indexabilityFor("/co/thin--com", q(""), { pageIndexable: false, inSitemap: false }).index, false);
    assert.equal(indexabilityFor("/co/acme--com", q("x=1"), { pageIndexable: true, inSitemap: true }).inSitemap, false);
  });
});

describe("derived outputs", () => {
  it("header and robots metadata agree with the policy", () => {
    assert.equal(robotsHeaderFor("/jobs", q("")), null);
    assert.equal(robotsHeaderFor("/jobs", q("q=x")), "noindex, nofollow, noarchive, nosnippet");
    assert.equal(robotsHeaderFor("/connect/help"), "noindex, follow, noarchive, nosnippet");
    assert.deepEqual(robotsMetadataFor("/login"), { robots: { index: false, follow: false } });
    assert.deepEqual(robotsMetadataFor("/connect/help"), { robots: { index: false, follow: true } });
    assert.deepEqual(robotsMetadataFor("/pricing"), {});
  });

  it("every robots.txt path disallow is a noindex class in the policy", () => {
    const patterns = new Set(buildRobotsRules().flatMap((r) => [r.disallow ?? []].flat()));
    for (const p of [...PRIVATE_PATHS, ...JOB_PATH_PREFIXES]) {
      assert.ok(patterns.has(p), `${p} missing from robots.txt`);
      assert.equal(indexabilityFor(`${p.replace(/\/$/, "")}/x`).index, false, `${p} is disallowed but not noindex`);
    }
    // Query URLs: Disallow stays AND the policy emits the noindex that backs it.
    assert.ok(patterns.has("/*?*"));
    assert.equal(indexabilityFor("/anything", q("a=b")).index, false);
  });
});

describe("sitemap", () => {
  const company = { domain: "acme.com", openRoleCount: 40, computedAt: "2026-10-20T00:00:00.000Z" };
  const undated = { domain: "undated.io", openRoleCount: 30, computedAt: null };

  it("every URL is indexable, listed by the policy, self-canonical and dated", async () => {
    const entries = await buildSitemapEntries(async () => [company, undated]);
    assert.ok(entries.length > SITEMAP_PAGES.length + 2);
    for (const entry of entries) {
      const path = new URL(entry.url).pathname;
      const policy = indexabilityFor(path, undefined, { pageIndexable: true, inSitemap: true });
      assert.equal(policy.index, true, `${path} is not indexable`);
      assert.equal(policy.inSitemap, true, `${path} is not listed by the policy`);
      assert.equal(policy.canonical, path, `${path} is not self-canonical`);
      assert.ok(entry.lastModified, `${path} has no lastmod`);
    }
    assert.ok(entries.some((e) => e.url === "https://velai.test/blog"));
    assert.equal(BLOG_PATH, "/blog");
    assert.equal(entries.find((e) => e.url.endsWith("/co/acme--com"))?.lastModified?.toString(), new Date(company.computedAt).toString());
  });

  it("a company fetch failure serves the pages, drops only /co/, and logs one error", async () => {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      const entries = await buildSitemapEntries(async () => {
        throw new Error("meili down");
      });
      assert.ok(entries.some((e) => e.url.endsWith("/jobs")));
      assert.ok(entries.some((e) => e.url.includes("/careers/")));
      assert.ok(entries.some((e) => e.url.includes("/blog/")));
      assert.equal(entries.some((e) => e.url.includes("/co/")), false);
      assert.equal(logged.length, 1);
      assert.match(String(logged[0][0]), /meili down/);
    } finally {
      console.error = original;
    }
  });
});

describe("/ and /jobs", () => {
  it("/ redirects permanently (308) to /jobs, in the page and in next.config", async () => {
    const { default: HomePage } = await import("@/app/page");
    const digest = await HomePage({ searchParams: Promise.resolve({}) }).catch((e: { digest?: string }) => e.digest);
    assert.match(String(digest), /^NEXT_REDIRECT;[a-z]+;\/jobs;308;/);
    const { default: config } = await import("../../next.config");
    const rules = (await config.redirects?.()) ?? [];
    for (const rule of rules.filter((r) => r.source === "/")) {
      assert.equal(rule.destination, "/jobs");
      assert.equal("permanent" in rule && rule.permanent, true);
    }
    assert.ok(rules.some((r) => r.source === "/"));
  });

  it("/jobs has its own title, description and self-canonical; every query variant canonicalises to it", () => {
    const bare = buildJobsMetadata({});
    assert.equal(bare.alternates?.canonical, "/jobs");
    assert.ok(bare.title && bare.description);
    assert.equal(bare.robots, undefined);
    for (const query of [{ q: "nurse" }, { location: ["Toronto", "Ottawa"], remote: "1" }]) {
      const variant = buildJobsMetadata(query);
      assert.equal(variant.alternates?.canonical, "/jobs");
      assert.deepEqual(variant.robots, { index: false, follow: false });
    }
  });
});

describe("job page soft-404", () => {
  const NOT_FOUND = /^NEXT_HTTP_ERROR_FALLBACK;404/;
  const digestOf = (run: () => Promise<unknown>) => run().then(() => "no error", (e: { digest?: string }) => e.digest);

  it("a malformed id and a well-formed unknown id both end in notFound()", async () => {
    const { default: JobPage, generateMetadata } = await import("@/app/jobs/[slug]/page");
    for (const slug of ["not-a-uuid", JOB_ID, `engineer-at-acme-${JOB_ID}`]) {
      assert.match(String(await digestOf(() => generateMetadata({ params: Promise.resolve({ slug }) }))), NOT_FOUND);
      assert.match(String(await digestOf(() => JobPage({ params: Promise.resolve({ slug }) }))), NOT_FOUND);
    }
  });

  it("the job route has no loading.tsx: a streamed fallback commits 200 before notFound() can set 404", () => {
    assert.equal(existsSync("src/app/jobs/[slug]/loading.tsx"), false);
  });
});
