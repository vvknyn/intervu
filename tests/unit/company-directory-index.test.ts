import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type DirectoryCompany } from "@/lib/companies/directory-model";
import { groupCompaniesByLetter, letterOf, topHubCompanies } from "@/lib/companies/directory-index";
import { CAREER_HUBS, careerHubSearchParams } from "@/lib/seo/career-hubs";
import { LEGAL_LINKS } from "@/components/layout/Footer";
import { buildSitemapEntries, resolveIndexableCompanies } from "@/lib/seo/sitemap-entries";
import { indexabilityFor, SITEMAP_PAGES } from "@/lib/seo/indexability";

const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
before(() => { process.env.NEXT_PUBLIC_SITE_URL = "https://velai.test"; });
after(() => {
  if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
});

/** A listed company; the name defaults to the domain word, the letter is the name's. */
const co = (domain: string, openRoleCount: number, name: string = domain.split(".")[0]!): DirectoryCompany => ({ domain, openRoleCount, computedAt: null, name, letter: letterOf(name) });

describe("groupCompaniesByLetter", () => {
  it("groups by the first letter of the listed name, A to Z then #, each group sorted by name", () => {
    const groups = groupCompaniesByLetter([co("zeta.com", 30), co("apple.com", 90, "Apple"), co("acme-corp.com", 40, "Acme Corp")]);
    assert.deepEqual(groups.map((g) => g.letter), ["A", "Z"]);
    assert.deepEqual(groups[0].entries.map((e) => e.name), ["Acme Corp", "Apple"]);
  });
  it("files a company under the letter of the name it shows, not of its domain", () => {
    const groups = groupCompaniesByLetter([co("ayvens.com", 30, "Ayvens"), co("carcare-aaa.com", 30, "AAA Car Care Centers"), co("meemic.com", 30, "ACS Auto Club Services")]);
    assert.deepEqual(groups.map((g) => [g.letter, g.entries.length]), [["A", 3]]);
    assert.ok(groups.every((g) => g.entries.every((e) => letterOf(e.name) === g.letter)));
  });
  it("puts digits and non-Latin starts under #, folds accented Latin letters onto their base letter", () => {
    const groups = groupCompaniesByLetter([co("1password.com", 30), co("eclair.fr", 26, "Éclair"), co("tokyo.jp", 25, "東京"), co("beta.io", 50)]);
    assert.deepEqual(groups.map((g) => g.letter), ["B", "E", "#"]);
    assert.deepEqual(groups[2].entries.map((e) => e.domain), ["1password.com", "tokyo.jp"]);
  });
  it("loses no company", () => {
    const input = [co("a.com", 25), co("b.com", 26), co("9.com", 27), co("u.de", 28, "Ünal")];
    const out = groupCompaniesByLetter(input).flatMap((g) => g.entries.map((e) => e.domain));
    assert.deepEqual(out.sort(), input.map((c) => c.domain).sort());
  });
});

describe("topHubCompanies", () => {
  const indexable = [co("acme.com", 40), co("beta.io", 30)];
  it("ranks by matching roles and keeps only indexable companies", () => {
    const hits = [
      { company_domain: "beta.io" }, { company_domain: "beta.io" }, { company_domain: "acme.com" },
      { company_domain: "thin.com" }, { company_domain: "thin.com" }, { company_domain: "thin.com" },
      { company_domain: null },
    ];
    assert.deepEqual(topHubCompanies(hits, indexable, 12).map((c) => c.domain), ["beta.io", "acme.com"]);
  });
  it("matches domains case-insensitively and caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => co(`c${i}.com`, 30));
    const hits = many.map((c) => ({ company_domain: c.domain.toUpperCase() }));
    assert.equal(topHubCompanies(hits, many, 12).length, 12);
  });
  it("is empty when no hit is in the indexable set", () => {
    assert.deepEqual(topHubCompanies([{ company_domain: "thin.com" }], indexable, 12), []);
  });
});

describe("careerHubSearchParams", () => {
  it("carries each hub's query and facets as arrays (query hub and facet hub)", () => {
    const query = CAREER_HUBS.find((h) => h.jobsQuery)!;
    const facet = CAREER_HUBS.find((h) => h.jobsFacets)!;
    assert.equal(careerHubSearchParams(query).q, query.jobsQuery);
    for (const [k, v] of Object.entries(facet.jobsFacets!)) {
      assert.deepEqual((careerHubSearchParams(facet).facets as Record<string, string[]>)[k], [v]);
    }
  });
});

describe("/co index wiring", () => {
  it("the page's company set is the sitemap's: same function, same last-good fallback", async () => {
    const store = { current: null };
    const set = [co("acme.com", 40)];
    assert.deepEqual(await resolveIndexableCompanies(async () => set, store), set);
    const down = async () => { throw new Error("meili down"); };
    const origErr = console.error; console.error = () => {};
    try {
      assert.deepEqual(await resolveIndexableCompanies(down, store), set);
    } finally { console.error = origErr; }
    const entries = await buildSitemapEntries(async () => set, { current: null });
    assert.ok(entries.some((e) => e.url.endsWith("/co/acme--com")));
  });
  it("policy: /co is indexable, self-canonical, in the sitemap; /co?letter=x is not; /co/<slug> unchanged", () => {
    assert.deepEqual(indexabilityFor("/co"), { index: true, follow: true, canonical: "/co", inSitemap: true });
    const letter = indexabilityFor("/co", new URLSearchParams("letter=x"));
    assert.deepEqual([letter.index, letter.inSitemap, letter.canonical], [false, false, "/co"]);
    assert.equal(indexabilityFor("/co/acme--com").inSitemap, false);
    assert.ok(SITEMAP_PAGES.some((p) => p.path === "/co"));
  });
  it("the footer links to /co", () => {
    assert.ok(LEGAL_LINKS.some((l) => l.href === "/co"));
  });
});

describe("/co pages render", () => {
  it("a full-cap set: /co links every letter group, each letter page is one page under 300 KB with a /co/<slug> link per company", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { LAST_GOOD } = await import("@/lib/seo/sitemap-entries");
    const { SITEMAP_COMPANY_CAP } = await import("@/lib/companies/indexable");
    const { letterPath } = await import("@/lib/companies/directory-index");
    const names = ["acme", "zenith", "1st", "kappa", "bright-path", "eclipse", "global", "omega"];
    const companies = Array.from({ length: SITEMAP_COMPANY_CAP }, (_, i) =>
      co(`${names[i % names.length]}-holdings-${i}.com`, 25 + (i % 500), `${names[i % names.length]} ${i}`));
    const { DIRECTORY_READER } = await import("@/lib/companies/directory-model");
    const readCached = DIRECTORY_READER.read;
    DIRECTORY_READER.read = async () => ({ companies });
    const prevHost = process.env.MEILISEARCH_HOST;
    delete process.env.MEILISEARCH_HOST;
    LAST_GOOD.current = { companies, at: Date.now() };
    const origErr = console.error; console.error = () => {};
    try {
      const { default: Index } = await import("@/app/co/page");
      const { default: Letter } = await import("@/app/co/letter/[letter]/page");
      const groups = groupCompaniesByLetter(companies);
      const indexHtml = renderToStaticMarkup(await Index());
      for (const { letter } of groups) assert.ok(indexHtml.includes(`href="${letterPath(letter)}"`), letter);
      let total = 0;
      for (const { letter, entries } of groups) {
        const segment = letterPath(letter).split("/").pop()!;
        const html = renderToStaticMarkup(await Letter({ params: Promise.resolve({ letter: segment }) }));
        const links = html.match(/href="\/co\/(?!letter)[^"]+"/g) ?? [];
        assert.equal(links.length, entries.length, letter);
        assert.ok(Buffer.byteLength(html) < 300_000, `${letter}: ${Buffer.byteLength(html)} bytes`);
        total += links.length;
      }
      assert.equal(total, SITEMAP_COMPANY_CAP);
      await assert.rejects(Letter({ params: Promise.resolve({ letter: "q" }) }), (e: { digest?: string }) => /404/.test(String(e.digest)));
    } finally {
      console.error = origErr;
      DIRECTORY_READER.read = readCached;
      LAST_GOOD.current = null;
      if (prevHost !== undefined) process.env.MEILISEARCH_HOST = prevHost;
    }
  });
  it("the sitemap lists /co and one page per letter group; policy lists those pages too", async () => {
    const set = [co("acme.com", 40), co("1password.com", 30)];
    const urls = (await buildSitemapEntries(async () => set, { current: null })).map((e) => new URL(e.url).pathname);
    for (const path of ["/co", "/co/letter/a", "/co/letter/other"]) {
      assert.ok(urls.includes(path), path);
      assert.deepEqual(indexabilityFor(path), { index: true, follow: true, canonical: path, inSitemap: true });
    }
  });
});
