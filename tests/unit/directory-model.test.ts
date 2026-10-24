import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDirectory, fetchCompanyInSitemapSet, fetchDirectory, type Directory } from "@/lib/companies/directory-model";
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

  it("V: a name that is the top non-agreeing candidate on 3+ domains is a vendor artifact and is never shown; on 2 it is a name", () => {
    const three = build([
      ["alpha.com", 50, { "Feedco Staffing": 4, "Alpha Labs": 1 }],
      ["beta.com", 50, { "Feedco Staffing": 4, "Beta Works": 1 }],
      ["gamma.com", 50, { "Feedco Staffing": 5 }],
    ]);
    assert.deepEqual(three.vendors, ["feedco staffing"]);
    assert.deepEqual(Object.keys(listed(three)).sort(), ["alpha.com", "beta.com"]);
    assert.deepEqual(excluded(three, "M4").map((e) => e.domain), ["gamma.com"]);
    const two = build([
      ["alpha.com", 50, { "Feedco Staffing": 5 }],
      ["beta.com", 50, { "Feedco Staffing": 5 }],
    ]);
    assert.deepEqual(two.vendors, []);
    assert.equal(two.companies.length, 1);
  });

  it("M2: a non-agreeing domain showing a name that strongly matches another pool domain's label is excluded; agreeing and unclaimed names stay", () => {
    const d = build([
      ["harborline.com", 90, { "Harborline Freight": 5 }],
      ["zmotors.com", 80, { "Harborline Freight": 5 }],
      ["paloaltonetworks.com", 70, { "Palo Alto Networks, Inc.": 5 }],
      ["r1rcm.com", 60, { "R1 RCM Holdco Inc.": 5 }],
      ["wpp.com", 50, { WPP: 5 }],
      ["unclaimed.example", 40, { "Orchid Foods": 5 }],
    ]);
    const m2 = excluded(d, "M2");
    assert.deepEqual(m2.map((e) => [e.domain, e.owner]), [["zmotors.com", "harborline.com"]]);
    assert.deepEqual(Object.keys(listed(d)).sort(), ["harborline.com", "paloaltonetworks.com", "r1rcm.com", "unclaimed.example", "wpp.com"]);
    assert.equal(listed(d)["unclaimed.example"], "Orchid Foods");
  });

  it("M3: two domains showing the same name keep the one with more roles", () => {
    const d = build([
      ["acme.io", 200, { Acme: 5 }],
      ["acme.com", 900, { Acme: 5 }],
    ]);
    assert.deepEqual(Object.keys(listed(d)), ["acme.com"]);
    assert.deepEqual(excluded(d, "M3").map((e) => [e.domain, e.owner]), [["acme.io", "acme.com"]]);
  });

  it("M4: no agreeing name and no name holding 60% of the rows means not listed", () => {
    const d = build([["mystery.com", 50, { "One Co": 2, "Two Co": 2, "Three Co": 1 }], ["acme.com", 40, { "Acme Robotics": 5 }]]);
    assert.deepEqual(Object.keys(listed(d)), ["acme.com"]);
    assert.deepEqual(excluded(d, "M4").map((e) => e.domain), ["mystery.com"]);
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
    const directory = async () => ({ companies: build([["acme.com", 40, { "Acme Robotics": 5 }]]).companies, vendors: [] });
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
