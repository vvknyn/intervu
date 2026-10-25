import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDirectory, distinctLegalNames, type Directory } from "@/lib/companies/directory-model";
import type { EachResult } from "@/lib/jobs/meilisearch";
import type { PublicJob } from "@/lib/jobs/types";

/** Each spec is a domain and the one company string its 5 rows carry. */
const build = (specs: [domain: string, company: string, extra?: { siteNames?: string[]; labelSpellings?: string[] }][]): Promise<Directory> =>
  buildDirectory(
    specs.map(([domain, , extra]) => ({ domain, openRoleCount: 5, computedAt: null, ...extra })),
    specs.map(([, company]): EachResult => ({ hits: Array.from({ length: 5 }, () => ({ company, title: "Engineer", location: "Remote" }) as PublicJob), total: 5 })),
    undefined,
    1,
  );
const listed = (d: Directory) => Object.fromEntries(d.companies.map((c) => [c.domain, c.name]));
const m3 = (d: Directory) => d.excluded.filter((e) => e.rule === "M3").map((e) => e.domain);

describe("buildDirectory — domains that collide on a display name but carry different legal names", () => {
  it("lists each under its legal name (ORBIS Inc. / ORBIS Corporation)", async () => {
    const d = await build([["orbisinc.net", "ORBIS Inc."], ["orbiscorporation.com", "ORBIS Corporation"]]);
    assert.deepEqual(listed(d), { "orbisinc.net": "ORBIS Inc.", "orbiscorporation.com": "ORBIS Corporation" });
    assert.deepEqual(m3(d), []);
  });

  it("is class-wide: Acme Inc. on acmeinc.com and Acme GmbH on acme-gruppe.de are both listed", async () => {
    const d = await build([["acmeinc.com", "Acme Inc."], ["acme-gruppe.de", "Acme GmbH"]]);
    assert.deepEqual(listed(d), { "acmeinc.com": "Acme Inc.", "acme-gruppe.de": "Acme GmbH" });
    assert.deepEqual(m3(d), []);
  });

  it("finds the legal form in the site names or row names when the resolver value has none (the ORBIS shapes)", async () => {
    const d = await build([
      ["orbisinc.net", "ORBIS", { siteNames: ["ORBIS Inc.", "An Engineering Solutions Company"] }],
      ["orbiscorporation.com", "US_ORB_4000\u200b ORBIS Corporation", { siteNames: ["Reusable Plastic Pallets & Containers", "ORBIS"], labelSpellings: ["ORBIS Corporation"] }],
    ]);
    assert.deepEqual(listed(d), { "orbisinc.net": "ORBIS Inc.", "orbiscorporation.com": "ORBIS Corporation" });
    const other = await build([["acmeinc.com", "Acme", { siteNames: ["Acme Inc."] }], ["acme-gruppe.de", "Acme", { siteNames: ["Acme GmbH"] }]]);
    assert.deepEqual(listed(other), { "acmeinc.com": "Acme Inc.", "acme-gruppe.de": "Acme GmbH" });
  });

  it("never swaps in a different name: a legal name that does not display as the colliding name is rejected", async () => {
    const d = await build([["marmon.com", "Marmon", { siteNames: ["Marmon Holdings, Inc."] }], ["marmon-group.de", "Marmon", { siteNames: ["Marmon GmbH"] }]]);
    assert.equal(m3(d).length, 1);
    assert.equal(d.companies.length, 1);
  });

  it("same registrable label on two TLDs is one company: M3 still applies", async () => {
    const d = await build([["linde-mh.ie", "Linde MH Ltd"], ["linde-mh.co.uk", "Linde MH Limited"]]);
    assert.equal(m3(d).length, 1);
    assert.equal(d.companies.length, 1);
  });

  it("one side without a legal form: M3 still applies", async () => {
    const d = await build([["acmeinc.com", "Acme Inc."], ["acme-group.de", "Acme"]]);
    assert.equal(m3(d).length, 1);
    assert.equal(d.companies.length, 1);
  });

  it("two sides sharing a legal name stay under M3 (distinctLegalNames separates only the distinct ones)", async () => {
    const group = [
      { domain: "acme-one.com", legal: "Acme Inc." },
      { domain: "acme-two.com", legal: "ACME INC." },
      { domain: "acme-gruppe.de", legal: "Acme GmbH" },
      { domain: "acme-corp.org", legal: "Acme Corporation" },
    ];
    assert.deepEqual([...distinctLegalNames(group)].sort(), ["acme-corp.org", "acme-gruppe.de"]);
    assert.deepEqual([...distinctLegalNames(group.slice(0, 3))], []);
  });
});
