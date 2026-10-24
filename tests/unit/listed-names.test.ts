import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { displayNameFromDomain } from "@/lib/companies/company-name";
import { fetchNameEvidence, resolveListedNames, type EvidenceFetcher } from "@/lib/companies/listed-names";
import type { PublicJob } from "@/lib/jobs/types";

const row = (company: string, title = "Engineer", location = "Remote") => ({ company, title, location }) as PublicJob;

describe("resolveListedNames", () => {
  it("shows the name the company page's rows give, not the domain label", async () => {
    const fetch: EvidenceFetcher = async () => [
      [row("Meta Platforms"), row("Meta Platforms", "Designer"), row("Meta Platforms", "Analyst")],
      [row("PwC", "Auditor", "Leeds"), row("PwC", "Tax", "York")],
    ];
    const names = await resolveListedNames(["meta.com", "pwc.com"], fetch, new Map());
    assert.equal(names["meta.com"], "Meta Platforms");
    assert.equal(names["pwc.com"], "PwC");
    assert.notEqual(names["meta.com"], displayNameFromDomain("meta.com"));
  });
  it("falls to the domain label only when the rows carry no name", async () => {
    const names = await resolveListedNames(["zenith.io"], async () => [[]], new Map());
    assert.equal(names["zenith.io"], "Zenith");
  });
  it("does not use internal postings or duplicate postings as evidence", async () => {
    const dupes = Array.from({ length: 5 }, () => row("Dupe Name", "Same Role", "Paris"));
    const fetch: EvidenceFetcher = async () => [[...dupes, row("Real Name", "Role A"), row("Real Name", "Role B")]];
    assert.equal((await resolveListedNames(["realname.com"], fetch, new Map()))["realname.com"], "Real Name");
  });
  it("on a failed read serves last-good names only when they cover every domain; never domain labels", async () => {
    const failing: EvidenceFetcher = async () => { throw new Error("meili down"); };
    const lastGood = new Map([["a.com", "Alpha Inc"]]);
    assert.deepEqual(await resolveListedNames(["a.com"], failing, lastGood), { "a.com": "Alpha Inc" });
    await assert.rejects(resolveListedNames(["a.com", "b.com"], failing, lastGood), /meili down/);
  });
});

describe("fetchNameEvidence batch retry", () => {
  const domains = Array.from({ length: 120 }, (_, i) => `d${i}.com`); // 3 batches: 50, 50, 20
  const answer = (queries: { params: { companyDomain?: string } }[]) => Promise.resolve(queries.map((q) => [row(q.params.companyDomain!)]));
  it("retries a non-first batch that fails once, resolving every domain", async () => {
    let failed = false;
    const read = mock.fn(async (queries: Parameters<typeof answer>[0]) => {
      if (!failed && queries.length === 50 && queries[0].params.companyDomain === "d50.com") { failed = true; throw new Error("blip"); }
      return answer(queries);
    });
    const rows = await fetchNameEvidence(domains, read as never);
    assert.deepEqual(rows.map((r) => r[0].company), domains);
    assert.equal(read.mock.callCount(), 4);
  });
  it("logs the batch index, size and error, then throws, when a batch fails twice", async () => {
    const err = mock.method(console, "error", () => {});
    try {
      const read = async (queries: Parameters<typeof answer>[0]) => {
        if (queries[0].params.companyDomain === "d100.com") throw new Error("meili 503");
        return answer(queries);
      };
      await assert.rejects(fetchNameEvidence(domains, read as never), /meili 503/);
      assert.equal(err.mock.callCount(), 1);
      assert.match(String(err.mock.calls[0].arguments[0]), /batch 2 \(20 domains\).*meili 503/);
    } finally { err.mock.restore(); }
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
