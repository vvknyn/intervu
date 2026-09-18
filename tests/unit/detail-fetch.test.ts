/**
 * `createDetailFetcher`/`detailFetcher` (lib/jobs/detail-fetch.ts) is the
 * ONE chokepoint every id-scoped detail fetch goes through: jobs/page.tsx's
 * `openJob` priming, dead-job existence check, SERP-hydrate effect, and
 * `retryDescription`, AND yours/[id]/page.tsx's `openDetail` and its retry
 * effect. Rewritten 2026-09-18 (`perf(jobs): hydrate descriptions via GET
 * route`) from a Server Action transport (serialized per client on Next's
 * action queue, see settle-guard.ts's `ACTION_SETTLE_TIMEOUT_MS` doc
 * comment for the measured prod cost) to a plain `fetch` against
 * `GET /api/jobs/[id]/description` — independent connections, no queue to
 * share, plus a bounded memo of settled results.
 *
 * `fetchImpl` is injected (same shape as the global `fetch`) so every test
 * here runs with no real network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDetailFetcher, isCacheableExistenceCheck, DETAIL_MEMO_LIMIT } from "../../src/lib/jobs/detail-fetch";
import type { ExistenceCheckStatus } from "../../src/lib/jobs/result-state";
import type { JobSearchResult, PublicJob } from "../../src/lib/jobs/types";

function fakeJob(id: string): PublicJob {
    return { id } as PublicJob;
}

function okResponse(body: JobSearchResult & { descriptionPending?: boolean }): Response {
    return { ok: true, json: async () => body } as Response;
}

function foundBody(id: string, overrides: { descriptionPending?: boolean } = {}) {
    return {
        hits: [fakeJob(id)],
        total: 1,
        backend: "meilisearch" as const,
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

describe("createDetailFetcher — transport", () => {
    it("fetches GET /api/jobs/[id]/description and classifies the JSON body as found", async () => {
        const calls: string[] = [];
        const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
            calls.push(String(input));
            return okResponse(foundBody("job-1"));
        };
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch);
        const check = await fetcher.fetch("job-1");
        assert.deepEqual(check, { status: "found", job: fakeJob("job-1"), descriptionPending: false });
        assert.deepEqual(calls, ["/api/jobs/job-1/description"]);
    });

    it("a non-ok response classifies as unknown, never thrown", async () => {
        const fetchImpl = async (): Promise<Response> => ({ ok: false } as Response);
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch);
        const check = await fetcher.fetch("job-1");
        assert.deepEqual(check, { status: "unknown" });
    });

    it("a thrown fetch (network error or abort deadline) classifies as unknown, never thrown to the caller", async () => {
        const fetchImpl = async (): Promise<Response> => {
            throw new DOMException("The operation was aborted", "AbortError");
        };
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch);
        const check = await fetcher.fetch("job-1");
        assert.deepEqual(check, { status: "unknown" });
    });

    it("URL-encodes the id", async () => {
        const calls: string[] = [];
        const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
            calls.push(String(input));
            return okResponse({ hits: [], total: 0, backend: "meilisearch", configured: true });
        };
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch);
        await fetcher.fetch("job/with slash");
        assert.deepEqual(calls, ["/api/jobs/job%2Fwith%20slash/description"]);
    });
});

describe("createDetailFetcher — concurrency", () => {
    it("two DIFFERENT ids fetch concurrently, not serialized — the class-wide fix this PR ships", async () => {
        const started: string[] = [];
        const gates = new Map<string, ReturnType<typeof deferred<Response>>>();
        const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
            const id = String(input).split("/")[3];
            started.push(id);
            const gate = deferred<Response>();
            gates.set(id, gate);
            return gate.promise;
        };
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch);
        const p1 = fetcher.fetch("job-a");
        const p2 = fetcher.fetch("job-b");
        // Both requests are already in flight before EITHER settles — proof
        // they weren't queued behind each other.
        assert.deepEqual(started.sort(), ["job-a", "job-b"]);
        gates.get("job-a")!.resolve(okResponse(foundBody("job-a")));
        gates.get("job-b")!.resolve(okResponse(foundBody("job-b")));
        const [r1, r2] = await Promise.all([p1, p2]);
        assert.equal(r1.status, "found");
        assert.equal(r2.status, "found");
    });

    it("a call for an id already in flight joins that same request — one network call, both callers get the same result", async () => {
        let calls = 0;
        const gate = deferred<Response>();
        const fetchImpl = async (): Promise<Response> => {
            calls++;
            return gate.promise;
        };
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch);
        const p1 = fetcher.fetch("job-1");
        const p2 = fetcher.fetch("job-1");
        gate.resolve(okResponse(foundBody("job-1")));
        const [r1, r2] = await Promise.all([p1, p2]);
        assert.equal(calls, 1);
        assert.equal(r1, r2);
    });
});

describe("createDetailFetcher — bounded memo of settled results", () => {
    it("a memo hit for a settled, cacheable id skips the network entirely", async () => {
        let calls = 0;
        const fetchImpl = async (): Promise<Response> => {
            calls++;
            return okResponse(foundBody("job-1"));
        };
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch);
        await fetcher.fetch("job-1");
        const second = await fetcher.fetch("job-1");
        assert.equal(calls, 1);
        assert.deepEqual(second, { status: "found", job: fakeJob("job-1"), descriptionPending: false });
    });

    it("a descriptionPending 'found' result is NEVER memoized — the next call re-fetches", async () => {
        let calls = 0;
        const fetchImpl = async (): Promise<Response> => {
            calls++;
            return okResponse(foundBody("job-1", { descriptionPending: true }));
        };
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch);
        await fetcher.fetch("job-1");
        await fetcher.fetch("job-1");
        assert.equal(calls, 2);
    });

    it("an 'unknown' (timeout/network-failure) result is NEVER memoized — a retry always re-fetches", async () => {
        let calls = 0;
        const fetchImpl = async (): Promise<Response> => {
            calls++;
            return { ok: false } as Response;
        };
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch);
        await fetcher.fetch("job-1");
        await fetcher.fetch("job-1");
        assert.equal(calls, 2);
    });

    it("evicts the oldest entry once the memo is full (FIFO), bounded at the configured limit", async () => {
        let calls = 0;
        const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
            calls++;
            const id = String(input).split("/")[3];
            return okResponse(foundBody(id));
        };
        const limit = 3;
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch, 12_000, limit);
        await fetcher.fetch("job-1");
        await fetcher.fetch("job-2");
        await fetcher.fetch("job-3");
        // Fills the memo (3 calls so far); one more distinct id evicts job-1.
        await fetcher.fetch("job-4");
        assert.equal(calls, 4);
        await fetcher.fetch("job-1"); // evicted — must re-fetch
        assert.equal(calls, 5);
        await fetcher.fetch("job-4"); // still cached — no re-fetch
        assert.equal(calls, 5);
    });
});

describe("createDetailFetcher — shared chokepoint, exercised the way yours/[id]/page.tsx uses it", () => {
    // yours/[id]/page.tsx's `openDetail` primes a fetch for the pursuit's
    // job_id; its separate retry effect (`detailFetcher.fetch(jobId)` again,
    // same single-argument call every caller makes — jobs/page.tsx included)
    // fires for the SAME id while the open is still resolving. This proves
    // the in-flight dedupe holds at the shared chokepoint itself, not only
    // for a For-you-flavored call shape.
    it("openDetail's priming fetch and a same-id retry effect join into one request", async () => {
        let calls = 0;
        const gate = deferred<Response>();
        const fetchImpl = async (): Promise<Response> => {
            calls++;
            return gate.promise;
        };
        const fetcher = createDetailFetcher(fetchImpl as typeof fetch);
        const jobId = "pursuit-job-42";
        const openDetail = () => fetcher.fetch(jobId);
        const retryEffect = () => fetcher.fetch(jobId);
        const opened = openDetail();
        const retried = retryEffect();
        gate.resolve(okResponse(foundBody(jobId)));
        const [openResult, retryResult] = await Promise.all([opened, retried]);
        assert.equal(calls, 1);
        assert.deepEqual(openResult, { status: "found", job: fakeJob(jobId), descriptionPending: false });
        assert.equal(openResult, retryResult);
    });
});

describe("isCacheableExistenceCheck", () => {
    it("unknown is never cacheable", () => {
        assert.equal(isCacheableExistenceCheck({ status: "unknown" }), false);
    });

    it("found with descriptionPending is never cacheable", () => {
        const check: ExistenceCheckStatus = { status: "found", job: fakeJob("x"), descriptionPending: true };
        assert.equal(isCacheableExistenceCheck(check), false);
    });

    it("found with a complete description is cacheable", () => {
        const check: ExistenceCheckStatus = { status: "found", job: fakeJob("x"), descriptionPending: false };
        assert.equal(isCacheableExistenceCheck(check), true);
    });

    it("not_found is cacheable", () => {
        assert.equal(isCacheableExistenceCheck({ status: "not_found" }), true);
    });
});

describe("DETAIL_MEMO_LIMIT", () => {
    it("is a positive, sane bound", () => {
        assert.ok(DETAIL_MEMO_LIMIT > 0 && DETAIL_MEMO_LIMIT < 10_000);
    });
});
