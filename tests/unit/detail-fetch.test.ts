import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDetailFetcher } from "../../src/lib/jobs/detail-fetch";
import { runExistenceCheck, type ExistenceCheckStatus } from "../../src/lib/jobs/result-state";

// `run` below fully replaces `runExistenceCheck` in every test, so `search`
// is never actually invoked — it only needs to type-check as the same
// second-argument shape `detailFetcher.fetch` forwards in production.
const search: Parameters<typeof runExistenceCheck>[1] = async () => {
    throw new Error("unused fake search");
};

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
