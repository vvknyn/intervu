import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDirectory, fetchCompanyInSitemapSet, fetchDirectory, singleFlight, type Directory } from "@/lib/companies/directory-model";
import { nameKey } from "@/lib/companies/company-name";
import { ATS_PORTAL_HOSTNAME_RE } from "@/lib/jobs/presentation";
import type { IndexableCompanyDomain } from "@/lib/companies/indexable";
import { companyOpenCount, companyRolesParams, COMPANY_JOBS_FETCH_LIMIT, publicRoles } from "@/lib/companies/company-roles-query";
import { buildCompanyFacts } from "@/lib/companies/company-facts";
import { buildRelatedCompanies } from "@/lib/companies/related-companies";
import type { EachResult } from "@/lib/jobs/meilisearch";
import type { PublicJob } from "@/lib/jobs/types";

/** A candidate and its role rows: `names` maps a company string to how many rows carry it. */
type Spec = [domain: string, roles: number, names: Record<string, number>, siteNames?: string[]];
const rowsOf = (names: Record<string, number>): PublicJob[] =>
  Object.entries(names).flatMap(([company, n]) => Array.from({ length: n }, (_, i) => ({ company, title: `${company} role ${i}`, location: "Remote" }) as PublicJob));
const readOf = (hits: PublicJob[]): EachResult => ({ hits, total: hits.length });
/** The threshold is 1 here: these cases are about names, and a handful of rows stands for a company. */
const build = (specs: Spec[], cap?: number, minRoles = 1): Promise<Directory> =>
  buildDirectory(specs.map(([domain, openRoleCount, , siteNames]): IndexableCompanyDomain => ({ domain, openRoleCount, computedAt: null, ...(siteNames && { siteNames }) })), specs.map(([, , names]) => readOf(rowsOf(names))), cap, minRoles);
const listed = (d: Directory) => Object.fromEntries(d.companies.map((c) => [c.domain, c.name]));
const excluded = (d: Directory, rule: string) => d.excluded.filter((e) => e.rule === rule);

describe("buildDirectory — which domains are listed, under what name and letter", () => {
  it("SQ: a domain-word name is listed under the site's expansion of it, with its letter; a real name is not expanded", async () => {
    const d = await build([
      ["pyramidhc.com", 5, { Pyramidhc: 5 }, ["An Integrated Behavioral Healthcare System", "Pyramid Healthcare"]],
      ["yale.edu", 4, { Yale: 4 }, ["Yale University"]],
    ]);
    assert.deepEqual(listed(d), { "pyramidhc.com": "Pyramid Healthcare", "yale.edu": "Yale" });
  });

  it("M1: a domain on an ATS or career-portal host is not listed (ashbyhq, greenhouse cdn, oraclecloud), a company domain is", async () => {
    const d = await build([
      ["app.ashbyhq.com", 90, { Ramp: 5 }],
      ["recruiting.cdn.greenhouse.io", 80, { Stripe: 5 }],
      ["fa-epmd-saasfaprod1.fa.ocs.oraclecloud.com", 70, { Montiac: 5 }],
      ["acme.com", 60, { "Acme Robotics": 5 }],
    ]);
    assert.deepEqual(Object.keys(listed(d)), ["acme.com"]);
    assert.deepEqual(excluded(d, "M1").map((e) => e.domain).sort(), ["app.ashbyhq.com", "fa-epmd-saasfaprod1.fa.ocs.oraclecloud.com", "recruiting.cdn.greenhouse.io"]);
    assert.ok(ATS_PORTAL_HOSTNAME_RE.test("tenant.oraclecloud.com"));
    assert.ok(!ATS_PORTAL_HOSTNAME_RE.test("oraclecloudstorage.com"));
  });

  it("R1: a domain is listed only when its name agrees with it; a dominant name the domain does not carry, or no name, is not a company", async () => {
    const d = await build([
      ["gelsight.com", 90, { Hyphenconnect: 9 }],
      ["collinstrading.com", 80, { "KFC Nederland (CFE)": 5 }],
      ["aspirant.com", 70, { Wavestone1: 4, Other: 1 }],
      ["silent.com", 60, {}],
      ["acme.com", 50, { "Acme Robotics": 5 }],
      ["ibm.com", 40, { "International Business Machines": 5 }],
      ["mixedname.com", 30, { "Mixedname Inc": 1, Elsewhere: 4 }],
    ]);
    assert.deepEqual(Object.keys(listed(d)), ["acme.com", "ibm.com", "mixedname.com"]);
    assert.deepEqual(excluded(d, "R1").map((e) => e.domain), ["gelsight.com", "collinstrading.com", "aspirant.com", "silent.com"]);
  });

  it("M3: two domains showing one name keep, in order: a majority-agreeing one, the one whose host label is the name, the fewer host labels, the busier", async () => {
    const bySharing = await build([
      ["northwind.io", 900, { Northwind: 2, "Other Co": 8 }],
      ["northwind.com", 100, { Northwind: 10 }],
    ]);
    assert.deepEqual(Object.keys(listed(bySharing)), ["northwind.com"]);
    assert.deepEqual(excluded(bySharing, "M3").map((e) => [e.domain, e.owner]), [["northwind.io", "northwind.com"]]);
    const byHostLabel = await build([
      ["zenitheyewear.com", 900, { Zenith: 3 }],
      ["zenith.com", 100, { Zenith: 6, "Other Co": 4 }],
    ]);
    assert.deepEqual(Object.keys(listed(byHostLabel)), ["zenith.com"]);
    assert.deepEqual(excluded(byHostLabel, "M3").map((e) => [e.domain, e.owner]), [["zenitheyewear.com", "zenith.com"]]);
    const corroborated = await build([
      ["corporate.northwind.com", 900, { "Northwind Corp": 9, "Northwind India (Non-USA)": 1 }],
      ["northwind.com", 100, { Northwind: 7, "Northwind India (Non-USA)": 3 }],
    ]);
    assert.deepEqual(Object.keys(listed(corroborated)), ["northwind.com"]);
    const byApex = await build([
      ["careers.contoso.com", 900, { Contoso: 5 }],
      ["contoso.com", 100, { Contoso: 5 }],
    ]);
    assert.deepEqual(Object.keys(listed(byApex)), ["contoso.com"]);
    const byRoles = await build([
      ["acme.io", 200, { Acme: 5 }],
      ["acme.com", 900, { Acme: 5 }],
    ]);
    assert.deepEqual(Object.keys(listed(byRoles)), ["acme.com"]);
    assert.deepEqual(excluded(byRoles, "M3").map((e) => [e.domain, e.owner]), [["acme.io", "acme.com"]]);
  });

  it("M5: fills to the cap from the candidates after the excluded ones, most roles first", async () => {
    const d = await build([
      ["app.ashbyhq.com", 500, { Ramp: 5 }],
      ["acme.com", 400, { "Acme Robotics": 5 }],
      ["beta.com", 300, { "Beta Works": 5 }],
      ["gamma.com", 200, { "Gamma Labs": 5 }],
    ], 2);
    assert.deepEqual(d.companies.map((c) => c.domain), ["acme.com", "beta.com"]);
  });

  it("L: the letter is that of the name shown, not of the domain", async () => {
    const d = await build([["ayvens.com", 50, { "LPSC Ayvens": 50 }], ["eclair.fr", 40, { "Éclair Boulangerie": 40 }], ["3m.com", 30, { "3M": 30 }]]);
    assert.deepEqual(d.companies.map((c) => [c.name, c.letter]), [["Ayvens", "A"], ["Éclair Boulangerie", "E"], ["3M", "#"]]);
  });
});

describe("fetchDirectory / fetchCompanyInSitemapSet", () => {
  it("reads candidates, then their rows in order, and builds the directory from them", async () => {
    const candidates = [{ domain: "acme.com", openRoleCount: 40, computedAt: null }];
    const d = await fetchDirectory(async () => candidates, async (domains) => domains.map(() => readOf(rowsOf({ "Acme Robotics": 30 }))));
    assert.deepEqual(listed(d), { "acme.com": "Acme Robotics" });
  });

  it("is true for a listed domain and false for one the directory excluded or does not hold", async () => {
    const directory = async () => ({ companies: (await build([["acme.com", 40, { "Acme Robotics": 5 }]])).companies });
    assert.equal(await fetchCompanyInSitemapSet("acme.com", directory), true);
    assert.equal(await fetchCompanyInSitemapSet("beta.com", directory), false);
  });

  it("rejects, rather than answering false, when the directory cannot be read: a failed read is not a membership answer", async () => {
    await assert.rejects(fetchCompanyInSitemapSet("acme.com", async () => { throw new Error("meili down"); }), /meili down/);
    await assert.rejects(fetchCompanyInSitemapSet("other.com", async () => { throw new Error("aborted"); }), /aborted/);
  });
});

describe("buildDirectory — SP: the listed name is the company's own spelling", () => {
  it("lists the homepage spelling when it only respells the agreed name; the letter and the page name follow the same value", async () => {
    const d = await build([
      ["aspendental.com", 90, { Aspendental: 5 }, ["Aspen Dental"]],
      ["airliquide.com", 80, { "AIR LIQUIDE": 5 }, ["Air Liquide"]],
      ["abbott.com", 70, { "Abbott Laboratories": 5 }, ["Abbott"]],
      ["fiveguys.com", 60, { "FIVE GUYS": 5 }, ["FIVE GUYS"]], // rows and site both shout: two witnesses
      ["aaff.com", 50, { aaff: 5 }, ["AAFF"]],
      ["acme.com", 40, { "Acme Robotics": 5 }],
    ]);
    assert.deepEqual(listed(d), { "aspendental.com": "Aspen Dental", "airliquide.com": "Air Liquide", "abbott.com": "Abbott", "fiveguys.com": "FIVE GUYS", "aaff.com": "AAFF", "acme.com": "Acme Robotics" });
    assert.equal(d.companies.find((c) => c.domain === "aspendental.com")?.letter, "A");
  });

  it("a lone all-caps site name does not turn a cased name into capitals; rows that carry the capitals keep them", async () => {
    const d = await build([
      ["zentrova.com", 90, { Zentrova: 5 }, ["ZENTROVA"]],
      ["qorvanta.com", 80, { QORVANTA: 5 }, ["QORVANTA"]],
    ]);
    assert.deepEqual(listed(d), { "zentrova.com": "Zentrova", "qorvanta.com": "QORVANTA" });
  });
});

describe("buildDirectory — M3 folds names the way a site name is folded", () => {
  it("lists one of Basic-Fit / Basic Fit and one of Domino's / Dominos, owners kept by the usual order", async () => {
    const d = await build([
      ["basic-fit.com", 310, { "Basic-Fit": 5 }],
      ["basic-fit.nl", 106, { "Basic Fit": 5 }],
      ["dominos.de", 50, { "Domino's": 5 }],
      ["ominos.com", 40, { Dominos: 5 }],
      ["acme.com", 30, { "Acme & Co": 5 }],
    ]);
    assert.deepEqual(Object.keys(listed(d)).sort(), ["acme.com", "basic-fit.com", "dominos.de"]);
    assert.deepEqual(excluded(d, "M3").map((e) => [e.domain, e.owner]).sort(), [["basic-fit.nl", "basic-fit.com"], ["ominos.com", "dominos.de"]]);
  });
});

describe("buildDirectory — M3 also compares the name before the host label settled it", () => {
  it("lists one of two domains whose rows name one company although the host label settled one of them differently; keeps an unrelated company", async () => {
    const d = await build([
      ["foobarbaz.com", 90, { "Foo Bar Baz": 9 }],
      ["foobar.com", 50, { "Foo Bar Baz": 5 }, ["Foo Bar"]],
      ["quxxon.com", 40, { Quxxon: 5 }],
    ]);
    assert.equal(d.companies.length, 2);
    assert.ok(d.companies.some((c) => c.domain === "quxxon.com"));
    // the survivor ranks on the unsettled name: foobarbaz.com's host IS that name, foobar.com's only is the settled one
    assert.deepEqual(excluded(d, "M3").map((e) => [e.domain, e.owner]), [["foobar.com", "foobarbaz.com"]]);
  });
});

describe("buildDirectory — M3 keeps names that differ by '&' versus 'and'", () => {
  it("lists both Goodwill domains (rows carry the Arizona name on both) and both Smith domains", async () => {
    const d = await build([
      ["goodwillaz.org", 520, { "Goodwill of Central and Northern Arizona": 5 }],
      ["sfgoodwill.org", 550, { "Goodwill of Central & Northern Arizona": 5 }],
      ["smithsons.com", 40, { "Smith & Sons": 5 }],
      ["smithandsons.com", 30, { "Smith and Sons": 5 }],
    ]);
    assert.equal(d.companies.length, 4);
    assert.equal(excluded(d, "M3").length, 0);
  });
});

describe("buildDirectory — yields to the event loop", () => {
  it("lets a timer set before the build fire before the build resolves, and still lists every company", async () => {
    // Each candidate's rows cost 10 ms of CPU to read, so 40 of them are 400 ms: far past the yield budget.
    const slow = (): EachResult => ({ get hits() { for (const end = performance.now() + 10; performance.now() < end;); return rowsOf({ Acme: 5 }); }, total: 5 }) as EachResult;
    let fired = false;
    setTimeout(() => (fired = true), 0);
    const specs = Array.from({ length: 40 }, (_, i): IndexableCompanyDomain => ({ domain: `acme${i}.com`, openRoleCount: 5, computedAt: null }));
    const d = await buildDirectory(specs, specs.map(slow), 100, 1);
    assert.equal(fired, true, "a timer set before the build fired before the build resolved");
    assert.equal(d.companies.length + d.excluded.length, 40);
  });
});

describe("buildDirectory — M3 survivor", () => {
  it("shows the better-spelled name of a same-key group; the survivor's own name stands for an unsettled-key collision", async () => {
    const d = await build([
      ["tranetechnologies.com", 90, { Tranetechnologies: 5 }],
      ["trane.com", 50, { "Trane Technologies": 5 }],
      ["uvahealth.org", 80, { Uvahealth: 5 }],
      ["uva.edu", 40, { "UVA Health": 5 }],
      ["foobarbaz.com", 70, { "Foo Bar Baz": 9 }],
      ["foobar.com", 30, { "Foo Bar Baz": 5 }, ["Foo Bar"]],
    ]);
    assert.equal(d.companies.find((c) => c.domain === "tranetechnologies.com")?.name, "Trane Technologies");
    assert.equal(d.companies.find((c) => c.domain === "uvahealth.org")?.name, "UVA Health");
    assert.equal(d.companies.find((c) => c.domain === "foobarbaz.com")?.name, "Foo Bar Baz");
  });

  it("a careers-purpose domain is its company: it merges into the main domain; the busier jobs domain survives a country domain", async () => {
    const d = await build([
      ["acme.com", 90, { Acme: 9 }],
      ["acmecareers.com", 50, { "Acme Studios": 5 }, ["Acme Careers"]],
      ["widget.de", 20, { Widget: 5 }],
      ["widgetjobs.com", 60, { Widget: 9 }],
    ]);
    assert.deepEqual(excluded(d, "M3").map((e) => [e.domain, e.owner]).sort(), [["acmecareers.com", "acme.com"], ["widget.de", "widgetjobs.com"]]);
    assert.deepEqual(d.companies.map((c) => c.domain).sort(), ["acme.com", "widgetjobs.com"]);
  });

  it("a jobs domain settles to the form of its site name the rows agree with, never adding a word the rows lack", async () => {
    const named = async (rows: string) => (await build([["widgetjobs.com", 50, { [rows]: 5 }, ["Widget Jobs"]]])).companies[0]?.name;
    assert.equal(await named("Widget Staffing Services"), "Widget Staffing Services");
    assert.equal(await named("Widget Jobs Network"), "Widget Jobs");
  });

  it("a jobs-purpose domain whose rows name a longer company keeps that name and is still a duplicate of the main domain", async () => {
    const d = await build([
      ["widget.com", 90, { Widget: 9 }],
      ["widgetjobs.com", 50, { "Widget Staffing Services": 5 }, ["Widget Jobs"]],
    ]);
    assert.deepEqual(excluded(d, "M3").map((e) => [e.domain, e.owner]), [["widgetjobs.com", "widget.com"]]);
    assert.deepEqual(d.companies.map((c) => c.name), ["Widget"]);
  });

  it("a hyphen is word structure: the survivor keeps its own hyphenated spelling", async () => {
    const d = await build([
      ["basic-fit.com", 90, { "Basic-Fit": 5 }],
      ["basic-fit.nl", 50, { "Basic Fit": 5 }],
      ["pearce-services.com", 80, { "Pearce-Services": 5 }],
      ["pearceservices.com", 40, { "Pearce Services": 5 }],
    ]);
    assert.equal(d.companies.find((c) => c.domain === "basic-fit.com")?.name, "Basic-Fit");
    assert.equal(d.companies.find((c) => c.domain === "pearce-services.com")?.name, "Pearce-Services");
  });

  it("a host label matching the settled name counts: the busier main domain survives", async () => {
    const d = await build([
      ["otis.com", 969, { "Otis Worldwide": 6, Otis: 3 }, ["Otis"]],
      ["otis.ch", 847, { Otis: 5 }],
    ]);
    assert.deepEqual(d.companies.map((c) => c.domain), ["otis.com"]);
  });
});

describe("nameKey — the M3 fold", () => {
  it("keeps distinct non-Latin names apart and folds spellings of one Latin name together", async () => {
    assert.notEqual(nameKey("トヨタ自動車"), nameKey("Яндекс"));
    assert.notEqual(nameKey("トヨタ自動車"), "");
    assert.equal(nameKey("Яндекс"), nameKey("ЯНДЕКС"));
    assert.equal(nameKey("Société-Fils"), nameKey("Societe Fils"));
    assert.notEqual(nameKey("Smith & Sons"), nameKey("Smith and Sons"));
  });
});

describe("singleFlight — one shared build, stale-while-revalidate", () => {
  const clock = (start = 0) => { let t = start; return { now: () => t, advance: (ms: number) => { t += ms; } }; };
  const gate = () => { let release!: (v: string) => void; let fail!: (e: Error) => void; const promise = new Promise<string>((res, rej) => { release = res; fail = rej; }); return { promise, release, fail }; };

  it("shares one in-flight build between concurrent cold callers, then serves the value until it is stale", async () => {
    const c = clock();
    let builds = 0;
    const g = gate();
    const read = singleFlight(() => { builds += 1; return g.promise; }, 1000, {}, c.now);
    const callers = [read(), read(), read()];
    g.release("v1");
    assert.deepEqual(await Promise.all(callers), ["v1", "v1", "v1"]);
    c.advance(999);
    assert.equal(await read(), "v1");
    assert.equal(builds, 1);
  });

  it("serves the old value while one background refresh runs, then the new one", async () => {
    const c = clock();
    const results = ["v1", "v2"];
    const gates = [gate(), gate()];
    let builds = 0;
    const read = singleFlight(() => gates[builds++]!.promise.then(() => results[builds - 1]!), 1000, {}, c.now);
    const first = read();
    gates[0]!.release("");
    assert.equal(await first, "v1");
    c.advance(1001);
    assert.equal(await read(), "v1");
    assert.equal(await read(), "v1");
    assert.equal(builds, 2);
    gates[1]!.release("");
    await new Promise((r) => setImmediate(r));
    assert.equal(await read(), "v2");
    assert.equal(builds, 2);
  });

  it("keeps the old value when a refresh fails and tries again on the next read", async () => {
    const c = clock();
    const outcomes: (string | Error)[] = ["v1", new Error("meili down"), "v3"];
    let builds = 0;
    const warn = console.warn;
    console.warn = () => {};
    try {
      const read = singleFlight(async () => { const o = outcomes[builds++]!; if (o instanceof Error) throw o; return o; }, 1000, {}, c.now);
      assert.equal(await read(), "v1");
      c.advance(1001);
      assert.equal(await read(), "v1");
      await new Promise((r) => setImmediate(r));
      assert.equal(await read(), "v1");
      await new Promise((r) => setImmediate(r));
      assert.equal(await read(), "v3");
      assert.equal(builds, 3);
    } finally { console.warn = warn; }
  });

  it("throws when the cold build fails, and builds again on the next read", async () => {
    let builds = 0;
    const read = singleFlight(async () => { if (builds++ === 0) throw new Error("cold failure"); return "ok"; }, 1000, {}, () => 0);
    await assert.rejects(read(), /cold failure/);
    assert.equal(await read(), "ok");
  });
});

/** `n` distinct roles, `dupes` re-posted copies of the first, and `internal` staffing postings. */
const mixedRows = (company: string, n: number, dupes: number, internal: number): PublicJob[] => [
  ...rowsOf({ [company]: n }),
  ...Array.from({ length: dupes }, () => ({ company, title: `${company} role 0`, location: "Remote" }) as PublicJob),
  ...Array.from({ length: internal }, (_, i) => ({ company, title: `[Internal] ${company} ${i}`, location: "Remote" }) as PublicJob),
];
const candidate = (domain: string, openRoleCount: number): IndexableCompanyDomain => ({ domain, openRoleCount, computedAt: null });

describe("buildDirectory — one open-roles number", () => {
  it("(a) a listed company's openRoleCount is the deduped count, not the raw tally: duplicates and internal postings are not counted", async () => {
    for (const [domain, company, n, dupes, internal] of [["acme.com", "Acme Robotics", 30, 5, 3], ["beta.com", "Beta Labs", 41, 0, 2]] as const) {
      const d = await buildDirectory([candidate(domain, n + dupes + internal)], [readOf(mixedRows(company, n, dupes, internal))]);
      assert.equal(d.companies[0]!.openRoleCount, n, domain);
    }
  });

  it("(b) raw at the threshold but canonical below it: excluded (T1), and the next candidate fills the place under a cap of 1", async () => {
    const d = await buildDirectory(
      [candidate("thin.com", 28), candidate("next.com", 26)],
      [readOf(mixedRows("Thin Works", 20, 5, 3)), readOf(mixedRows("Next Works", 26, 0, 0))],
      1,
    );
    assert.deepEqual(d.companies.map((c) => [c.domain, c.openRoleCount]), [["next.com", 26]]);
    assert.deepEqual(d.excluded, [{ domain: "thin.com", rule: "T1" }]);
  });

  it("sorts by the canonical number, not the raw one", async () => {
    const d = await buildDirectory(
      [candidate("padded.com", 90), candidate("honest.com", 60)],
      [readOf(mixedRows("Padded Co", 30, 40, 20)), readOf(mixedRows("Honest Co", 60, 0, 0))],
    );
    assert.deepEqual(d.companies.map((c) => c.domain), ["honest.com", "padded.com"]);
  });

  it("(d) conservation: page facts, directory row, related entry and job-detail rail give one number for one fixture", async () => {
    const result = { ...readOf(mixedRows("Acme Robotics", 33, 6, 4)), total: 43 };
    const page = buildCompanyFacts({ name: "Acme Robotics", domain: "acme.com", jobs: publicRoles(result.hits), openCount: companyOpenCount(result), postingTotal: result.total }).hiring.openCount;
    const row = (await buildDirectory([candidate("acme.com", 43)], [result])).companies[0]!;
    const related = buildRelatedCompanies(["acme.com"], [row], "other.com")[0]!.openRoleCount;
    const rail = companyOpenCount(result).value; // getCompanyRailAction / getCompanyOpenCountAction return exactly this call
    assert.deepEqual([page, row.openRoleCount, related, rail], [33, 33, 33, 33]);
    assert.equal(companyRolesParams("acme.com").limit, COMPANY_JOBS_FETCH_LIMIT);
  });

  it("a saturated window reads as the backend's count, as the company page does", async () => {
    const hits = rowsOf({ "Big Co": COMPANY_JOBS_FETCH_LIMIT });
    assert.equal((await buildDirectory([candidate("big.com", 900)], [{ hits, total: 900 }])).companies[0]!.openRoleCount, 900);
  });
});

describe("mix shares divide by the posting population the facets counted", () => {
  const facts = (openCount: number, postingTotal: number, facetDistribution: Record<string, Record<string, number>>) =>
    buildCompanyFacts({ name: "Acme", domain: "acme.com", jobs: [], openCount: { value: openCount, isLowerBound: false }, postingTotal, facetDistribution: facetDistribution as never });
  const share = (d: { buckets: { value: string; count: number }[]; total: number }, value: string) => d.buckets.find((b) => b.value === value)!.count / d.total;

  it("30 deduped roles over 60 raw postings, 45 full-time: 75%, not 100%; the headline stays the deduped 30", async () => {
    const f = facts(30, 60, { employment_type: { full_time: 45, part_time: 15 } });
    assert.equal(f.hiring.openCount, 30);
    assert.equal(share(f.mix.employmentType!, "Full Time"), 0.75);
  });

  it("a top bucket below the open count is a share of the postings, not of the open count (visa too)", async () => {
    const f = facts(100, 160, { work_type: { remote: 40, onsite: 20 }, visa_sponsorship: { true: 10, false: 30 } });
    assert.equal(share(f.mix.workType!, "Remote"), 40 / 160);
    assert.deepEqual(f.mix.visaSponsorship, { sponsors: 10, stated: 40, total: 160 });
  });
});
