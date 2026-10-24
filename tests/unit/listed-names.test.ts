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

describe("fetchNameEvidence failure is never partial", () => {
  const answer = (queries: { params: { companyDomain?: string } }[]) => queries.map((q) => [row(q.params.companyDomain!)]);
  it("a failure in the LAST chunk rejects the whole read (no rows returned for the chunks that worked)", async () => {
    const domains = Array.from({ length: 450 }, (_, i) => `d${i}.com`); // 3 chunks
    const err = mock.method(console, "error", () => {});
    try {
      const read = async (queries: Parameters<typeof answer>[0]) => {
        if (queries.some((q) => q.params.companyDomain === "d449.com")) throw new Error("meili timeout");
        return answer(queries);
      };
      await assert.rejects(fetchNameEvidence(domains, read as never), /meili timeout/);
    } finally { err.mock.restore(); }
  });
  it("stops starting chunks once one has failed, so a dead build does not keep loading Meilisearch", async () => {
    const domains = Array.from({ length: 150 * 20 }, (_, i) => `d${i}.com`); // 20 chunks, 4 in flight
    const err = mock.method(console, "error", () => {});
    const started = new Set<string>();
    try {
      const read = async (queries: Parameters<typeof answer>[0]) => {
        started.add(queries[0]!.params.companyDomain!);
        if (queries[0]!.params.companyDomain === "d0.com") throw new Error("boom");
        await new Promise((r) => setTimeout(r, 5));
        return answer(queries);
      };
      await assert.rejects(fetchNameEvidence(domains, read as never), /boom/);
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(started.size < 20 * 3, `started ${started.size} batches`);
    } finally { err.mock.restore(); }
  });
  it("reads with a timeout sized to the read (measured 4-9 s per 50-domain batch), not the 8 s search default", async () => {
    const { EVIDENCE_TIMEOUT_MS } = await import("@/lib/companies/listed-names");
    const { MEILI_FETCH_TIMEOUT_MS } = await import("@/lib/jobs/meilisearch");
    let seen: unknown;
    await fetchNameEvidence(["a.com"], (async (queries: Parameters<typeof answer>[0], timeoutMs?: number) => { seen = timeoutMs; return answer(queries); }) as never);
    assert.equal(seen, EVIDENCE_TIMEOUT_MS);
    assert.ok(EVIDENCE_TIMEOUT_MS >= 3 * 9_100 && EVIDENCE_TIMEOUT_MS > MEILI_FETCH_TIMEOUT_MS);
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
