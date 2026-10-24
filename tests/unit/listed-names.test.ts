import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayNameFromDomain } from "@/lib/companies/company-name";
import { resolveListedNames, type EvidenceFetcher } from "@/lib/companies/listed-names";
import type { PublicJob } from "@/lib/jobs/types";

const row = (company: string, title = "Engineer", location = "Remote") => ({ company, title, location }) as PublicJob;

describe("resolveListedNames", () => {
  it("shows the name the company page's rows give, not the domain label", async () => {
    const fetch: EvidenceFetcher = async () => [
      [row("Meta Platforms"), row("Meta Platforms", "Designer"), row("Meta Platforms", "Analyst")],
      [row("PwC", "Auditor", "Leeds"), row("PwC", "Tax", "York")],
    ];
    const names = await resolveListedNames(["fb.com", "pwc.com"], fetch, new Map());
    assert.equal(names["fb.com"], "Meta Platforms");
    assert.equal(names["pwc.com"], "PwC");
    assert.notEqual(names["fb.com"], displayNameFromDomain("fb.com"));
  });
  it("falls to the domain label only when the rows carry no name", async () => {
    const names = await resolveListedNames(["zenith.io"], async () => [[]], new Map());
    assert.equal(names["zenith.io"], "Zenith");
  });
  it("does not use internal postings or duplicate postings as evidence", async () => {
    const dupes = Array.from({ length: 5 }, () => row("Dupe Name", "Same Role", "Paris"));
    const fetch: EvidenceFetcher = async () => [[...dupes, row("Real Name", "Role A"), row("Real Name", "Role B")]];
    assert.equal((await resolveListedNames(["x.com"], fetch, new Map()))["x.com"], "Real Name");
  });
  it("on a failed read serves last-good names only when they cover every domain; never domain labels", async () => {
    const failing: EvidenceFetcher = async () => { throw new Error("meili down"); };
    const lastGood = new Map([["a.com", "Alpha Inc"]]);
    assert.deepEqual(await resolveListedNames(["a.com"], failing, lastGood), { "a.com": "Alpha Inc" });
    await assert.rejects(resolveListedNames(["a.com", "b.com"], failing, lastGood), /meili down/);
  });
});

describe("displayNameFromDomain casing", () => {
  it("upper-cases the first letter of each label for any script with case", () => {
    assert.equal(displayNameFromDomain("éclair.fr"), "Éclair");
    assert.equal(displayNameFromDomain("über-corp.de"), "Über Corp");
    assert.equal(displayNameFromDomain("ñandu-labs.es"), "Ñandu Labs");
    assert.equal(displayNameFromDomain("1password.com"), "1Password");
  });
});
