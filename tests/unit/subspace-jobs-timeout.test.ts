import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// Must be set before the module under test is imported — `requireApiKey()`
// throws a (different) SubspaceJobsError otherwise. A dynamic import inside
// `before` (rather than a static import) is what actually lets this env-var
// assignment run first; the test runner here transpiles to CJS, which
// rejects top-level await outright.
process.env.SUBSPACE_API_KEY = "test";

type SubspaceJobsModule = typeof import("../../src/lib/jobs/subspaceJobs");

const VALID_ID = "11111111-1111-4111-8111-111111111111";

describe("subspaceJobs deadline at the HTTP-client seam", () => {
  let subspaceJobs: SubspaceJobsModule;

  before(async () => {
    subspaceJobs = await import("../../src/lib/jobs/subspaceJobs");
  });

  it("fillVisibleDescriptions rejects with a timeout SubspaceJobsError once the deadline fires", async () => {
    const originalFetch = globalThis.fetch;
    // Models a scrape-ladder call that outlives its deadline: the stub never
    // resolves on its own — only the abort signal settles it, exactly as
    // undici's real fetch rejects with `signal.reason` when the passed
    // AbortSignal fires first.
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        // `AbortSignal.timeout()`'s own internal timer is unref'd — a real
        // fetch's in-flight socket is what actually keeps the process alive
        // long enough for it to fire. This stub has no such handle, so
        // without one of our own the event loop can look drained before the
        // abort ever arrives, and node:test cancels the test as a stuck
        // promise. Hold a ref'd interval until the signal settles.
        const keepAlive = setInterval(() => {}, 1000);
        const settle = (err: unknown) => {
          clearInterval(keepAlive);
          reject(err);
        };
        if (signal.aborted) {
          settle(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => settle(signal.reason));
      });
    }) as typeof fetch;

    try {
      await assert.rejects(
        subspaceJobs.fillVisibleDescriptions([VALID_ID], { mode: "visible", timeoutMs: 20 }),
        (e: unknown) => {
          assert.ok(e instanceof subspaceJobs.SubspaceJobsError, "expected a SubspaceJobsError");
          assert.equal((e as InstanceType<SubspaceJobsModule["SubspaceJobsError"]>).code, "timeout");
          assert.equal(subspaceJobs.isSubspaceTimeout(e), true);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("a fast response wins before the deadline — timeoutMs never breaks the fast path", async () => {
    const originalFetch = globalThis.fetch;
    const body = { data: [{ id: VALID_ID, description: "Filled by the ladder." }] };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      const result = await subspaceJobs.fillVisibleDescriptions([VALID_ID], { mode: "visible", timeoutMs: 1000 });
      assert.deepEqual(result, body.data);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
