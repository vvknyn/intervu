import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDetailFetcher } from "../../src/lib/jobs/detail-fetch";
import { runExistenceCheck, type ExistenceCheckStatus } from "../../src/lib/jobs/result-state";
import type { JobSearchResult, PublicJob } from "../../src/lib/jobs/types";

// `run` below fully replaces `runExistenceCheck` in every test, so `search`
// is never actually invoked — it only needs to type-check as the same
// second-argument shape `detailFetcher.fetch` forwards in production.
const search: Parameters<typeof runExistenceCheck>[1] = async () => {
    throw new Error("unused fake search");
};

function result(
    overrides: Partial<JobSearchResult> & { descriptionPending?: boolean } = {},
): JobSearchResult & { descriptionPending?: boolean } {
    return {
        hits: [],
        total: 0,
        backend: "meilisearch",
        configured: true,
        ...overrides,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe("createDetailFetcher", () => {
    it("joins an in-flight request for the same id — one call, both callers get the same result", async () => {
        let calls = 0;
        const pending = deferred<ExistenceCheckStatus>();
        const run = async (): Promise<ExistenceCheckStatus> => {
            calls++;
            return pending.promise;
        };
        const fetcher = createDetailFetcher(run);
        const p1 = fetcher.fetch("job-1", search);
        const p2 = fetcher.fetch("job-1", search);
        pending.resolve({ status: "not_found" });
        const [r1, r2] = await Promise.all([p1, p2]);
        assert.equal(calls, 1);
        assert.equal(r1, r2);
    });

    it("starts a NEW request once the prior one for the same id has settled (retry semantics)", async () => {
        let calls = 0;
        const run = async (): Promise<ExistenceCheckStatus> => {
            calls++;
            return { status: "not_found" };
        };
        const fetcher = createDetailFetcher(run);
        await fetcher.fetch("job-1", search);
        await fetcher.fetch("job-1", search);
        assert.equal(calls, 2);
    });

    it("dispatches independently for two different ids", async () => {
        let calls = 0;
        const run = async (): Promise<ExistenceCheckStatus> => {
            calls++;
            return { status: "not_found" };
        };
        const fetcher = createDetailFetcher(run);
        await Promise.all([fetcher.fetch("job-1", search), fetcher.fetch("job-2", search)]);
        assert.equal(calls, 2);
    });

    it("clears the in-flight entry on an inconclusive (unknown) result too, so the next call re-invokes", async () => {
        let calls = 0;
        const run = async (): Promise<ExistenceCheckStatus> => {
            calls++;
            return { status: "unknown" };
        };
        const fetcher = createDetailFetcher(run);
        const r1 = await fetcher.fetch("job-1", search);
        assert.equal(r1.status, "unknown");
        await fetcher.fetch("job-1", search);
        assert.equal(calls, 2);
    });
});

// These use the REAL `runExistenceCheck` (production default) so the
// fetcher's own `withSettleGuard` wrapping — not a mocked `run` — is what's
// under test. `settleMs: 20` stands in for `DETAIL_SETTLE_TIMEOUT_MS` so the
// suite doesn't wait out the real 25s budget.
describe("createDetailFetcher — owns its own settle budget", () => {
    it('resolves "unknown" once its own budget lapses, even though `search` never settles', async () => {
        const neverSettles: Parameters<typeof runExistenceCheck>[1] = () => new Promise(() => {});
        const fetcher = createDetailFetcher(runExistenceCheck, 20);
        const check = await fetcher.fetch("job-1", neverSettles);
        assert.deepEqual(check, { status: "unknown" });
    });

    it("retries with a fresh request for the SAME id after a budget timeout — retry semantics survive the guard", async () => {
        let calls = 0;
        const job = { id: "job-1" } as PublicJob;
        const flaky: Parameters<typeof runExistenceCheck>[1] = async () => {
            calls++;
            if (calls === 1) return new Promise(() => {}); // first call: never settles, times out
            return result({ hits: [job], total: 1 });
        };
        const fetcher = createDetailFetcher(runExistenceCheck, 20);
        const first = await fetcher.fetch("job-1", flaky);
        assert.equal(first.status, "unknown");
        const second = await fetcher.fetch("job-1", flaky);
        assert.deepEqual(second, { status: "found", job, descriptionPending: false });
        assert.equal(calls, 2);
    });

    it("a DIFFERENT id in flight at the same time is unaffected by another id's timeout and resolves found", async () => {
        const stuckId = "job-stuck";
        const okId = "job-ok";
        const okJob = { id: okId } as PublicJob;
        const search: Parameters<typeof runExistenceCheck>[1] = async (q) => {
            if (q.id === stuckId) return new Promise(() => {}); // never settles
            return result({ hits: [okJob], total: 1 });
        };
        const fetcher = createDetailFetcher(runExistenceCheck, 20);
        const [stuck, ok] = await Promise.all([fetcher.fetch(stuckId, search), fetcher.fetch(okId, search)]);
        assert.deepEqual(stuck, { status: "unknown" });
        assert.deepEqual(ok, { status: "found", job: okJob, descriptionPending: false });
    });
});
