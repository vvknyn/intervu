import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { displayNameFromDomain } from "@/lib/companies/company-name";
import { fetchNameEvidence } from "@/lib/companies/listed-names";
import type { PublicJob } from "@/lib/jobs/types";

const row = (company: string, title = "Engineer", location = "Remote") => ({ company, title, location }) as PublicJob;

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

describe("fetchNameEvidence concurrency", () => {
  it("reads several chunks at once, never more than 4 at a time, and keeps the order of the domains", async () => {
    const domains = Array.from({ length: 1500 }, (_, i) => `d${i}.com`); // 10 chunks of 150, 3 batches each
    let live = 0;
    let peak = 0;
    const read = async (queries: { params: { companyDomain?: string } }[]) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return queries.map((q) => [row(q.params.companyDomain!)]);
    };
    const rows = await fetchNameEvidence(domains, read as never);
    assert.deepEqual(rows.map((r) => r[0].company), domains);
    assert.ok(peak > 3 && peak <= 12, `peak in-flight batches ${peak}`);
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
