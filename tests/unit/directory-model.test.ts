import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDirectory, fetchCompanyInSitemapSet, fetchDirectory, singleFlight, type Directory } from "@/lib/companies/directory-model";
import { ATS_PORTAL_HOSTNAME_RE } from "@/lib/jobs/presentation";
import type { IndexableCompanyDomain } from "@/lib/companies/indexable";
import type { PublicJob } from "@/lib/jobs/types";

/** A candidate and its role rows: `names` maps a company string to how many rows carry it. */
type Spec = [domain: string, roles: number, names: Record<string, number>];
const rowsOf = (names: Record<string, number>): PublicJob[] =>
  Object.entries(names).flatMap(([company, n]) => Array.from({ length: n }, (_, i) => ({ company, title: `${company} role ${i}`, location: "Remote" }) as PublicJob));
const build = (specs: Spec[], cap?: number): Directory =>
  buildDirectory(specs.map(([domain, openRoleCount]): IndexableCompanyDomain => ({ domain, openRoleCount, computedAt: null })), specs.map(([, , names]) => rowsOf(names)), cap);
const listed = (d: Directory) => Object.fromEntries(d.companies.map((c) => [c.domain, c.name]));
const excluded = (d: Directory, rule: string) => d.excluded.filter((e) => e.rule === rule);

describe("buildDirectory — which domains are listed, under what name and letter", () => {
  it("M1: a domain on an ATS or career-portal host is not listed (ashbyhq, greenhouse cdn, oraclecloud), a company domain is", () => {
    const d = build([
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

  it("R1: a domain is listed only when its name agrees with it; a dominant name the domain does not carry, or no name, is not a company", () => {
    const d = build([
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

  it("M3: two domains showing one name keep the higher agreement share, then the apex over a subdomain, then more roles", () => {
    const bySharing = build([
      ["northwind.io", 900, { Northwind: 2, "Other Co": 8 }],
      ["northwind.com", 100, { Northwind: 10 }],
    ]);
    assert.deepEqual(Object.keys(listed(bySharing)), ["northwind.com"]);
    assert.deepEqual(excluded(bySharing, "M3").map((e) => [e.domain, e.owner]), [["northwind.io", "northwind.com"]]);
    const corroborated = build([
      ["corporate.northwind.com", 900, { "Northwind Corp": 9, "Northwind India (Non-USA)": 1 }],
      ["northwind.com", 100, { Northwind: 7, "Northwind India (Non-USA)": 3 }],
    ]);
    assert.deepEqual(Object.keys(listed(corroborated)), ["northwind.com"]);
    const byApex = build([
      ["careers.contoso.com", 900, { Contoso: 5 }],
      ["contoso.com", 100, { Contoso: 5 }],
    ]);
    assert.deepEqual(Object.keys(listed(byApex)), ["contoso.com"]);
    const byRoles = build([
      ["acme.io", 200, { Acme: 5 }],
      ["acme.com", 900, { Acme: 5 }],
    ]);
    assert.deepEqual(Object.keys(listed(byRoles)), ["acme.com"]);
    assert.deepEqual(excluded(byRoles, "M3").map((e) => [e.domain, e.owner]), [["acme.io", "acme.com"]]);
  });

  it("M5: fills to the cap from the candidates after the excluded ones, most roles first", () => {
    const d = build([
      ["app.ashbyhq.com", 500, { Ramp: 5 }],
      ["acme.com", 400, { "Acme Robotics": 5 }],
      ["beta.com", 300, { "Beta Works": 5 }],
      ["gamma.com", 200, { "Gamma Labs": 5 }],
    ], 2);
    assert.deepEqual(d.companies.map((c) => c.domain), ["acme.com", "beta.com"]);
  });

  it("L: the letter is that of the name shown, not of the domain", () => {
    const d = build([["ayvens.com", 50, { "LPSC Ayvens": 5 }], ["eclair.fr", 40, { "Éclair Boulangerie": 5 }], ["3m.com", 30, { "3M": 5 }]]);
    assert.deepEqual(d.companies.map((c) => [c.name, c.letter]), [["Ayvens", "A"], ["Éclair Boulangerie", "E"], ["3M", "#"]]);
  });
});

describe("fetchDirectory / fetchCompanyInSitemapSet", () => {
  it("reads candidates, then their rows in order, and builds the directory from them", async () => {
    const candidates = [{ domain: "acme.com", openRoleCount: 40, computedAt: null }];
    const d = await fetchDirectory(async () => candidates, async (domains) => domains.map(() => rowsOf({ "Acme Robotics": 3 })));
    assert.deepEqual(listed(d), { "acme.com": "Acme Robotics" });
  });

  it("is true for a listed domain and false for one the directory excluded or does not hold", async () => {
    const directory = async () => ({ companies: build([["acme.com", 40, { "Acme Robotics": 5 }]]).companies, });
    assert.equal(await fetchCompanyInSitemapSet("acme.com", directory), true);
    assert.equal(await fetchCompanyInSitemapSet("beta.com", directory), false);
  });

  it("is false and warns exactly once, rather than throwing, when the directory cannot be read", async () => {
    const original = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      assert.equal(await fetchCompanyInSitemapSet("acme.com", async () => { throw new Error("meili down"); }), false);
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = original;
    }
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
