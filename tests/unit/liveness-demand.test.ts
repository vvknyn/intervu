import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDemandReporter,
  FLUSH_DELAY_MS,
  MAX_IDS_PER_BATCH,
  MAX_PENDING,
  PAUSE_AFTER_FAILURE_MS,
  PAUSE_AFTER_REJECT_MS,
  REPORT_TTL_MS,
  type DemandBatch,
} from "../../src/lib/jobs/liveness-demand";
import { SubspaceJobsError } from "../../src/lib/jobs/subspaceJobs";

const id = (n: number) => `${n.toString(16).padStart(8, "0")}-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
const A = id(1);
const B = id(2);
const C = id(3);

function harness(opts: { fail?: (batch: DemandBatch) => unknown; enabled?: boolean } = {}) {
  let clock = 1_000_000;
  const sent: DemandBatch[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const logs: string[] = [];
  const reporter = createDemandReporter({
    enabled: () => opts.enabled ?? true,
    now: () => clock,
    schedule: (fn, ms) => timers.push({ fn, ms }),
    log: (m) => logs.push(m),
    send: async (batch) => {
      sent.push(batch);
      const err = opts.fail?.(batch);
      if (err) throw err;
    },
  });
  return {
    reporter,
    sent,
    timers,
    logs,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test("reporting only buffers: nothing is sent until the one scheduled flush", async () => {
  const h = harness();
  h.reporter.reportShown([A, B]);
  h.reporter.reportShown([C]);
  assert.equal(h.sent.length, 0);
  assert.equal(h.timers.length, 1, "one timer per flush window, not one per call");
  assert.equal(h.timers[0].ms, FLUSH_DELAY_MS);
  await h.reporter.flush();
  assert.deepEqual(h.sent, [{ ids: [A, B, C], urgent: false }]);
});

test("ids are validated, lowercased and deduped; junk never reaches Subspace", async () => {
  const h = harness();
  h.reporter.reportShown([A.toUpperCase(), A, " " + B + " ", "not-a-uuid", "", "123"]);
  await h.reporter.flush();
  assert.deepEqual(h.sent, [{ ids: [A, B], urgent: false }]);
});

test("an opened id goes out once, as urgent, ahead of shown ids", async () => {
  const h = harness();
  h.reporter.reportShown([A, B]);
  h.reporter.reportOpened(B);
  await h.reporter.flush();
  assert.deepEqual(h.sent, [
    { ids: [B], urgent: true },
    { ids: [A], urgent: false },
  ]);
});

test("the same id is not re-sent inside the TTL, and is again after it", async () => {
  const h = harness();
  h.reporter.reportShown([A]);
  await h.reporter.flush();
  h.advance(REPORT_TTL_MS - 1);
  h.reporter.reportShown([A]);
  await h.reporter.flush();
  assert.equal(h.sent.length, 1);
  h.advance(1);
  h.reporter.reportShown([A]);
  await h.reporter.flush();
  assert.equal(h.sent.length, 2);
});

test("a shown id that is then opened still goes out as urgent", async () => {
  const h = harness();
  h.reporter.reportShown([A]);
  await h.reporter.flush();
  h.reporter.reportOpened(A);
  await h.reporter.flush();
  assert.deepEqual(h.sent[1], { ids: [A], urgent: true });
});

test("big buffers split into Subspace-sized batches; the buffer itself is capped", async () => {
  const h = harness();
  h.reporter.reportShown(Array.from({ length: MAX_PENDING + 50 }, (_, i) => id(i + 1)));
  await h.reporter.flush();
  const total = h.sent.reduce((n, b) => n + b.ids.length, 0);
  assert.equal(total, MAX_PENDING);
  assert.ok(h.sent.every((b) => b.ids.length <= MAX_IDS_PER_BATCH));
});

test("disabled (no SUBSPACE_API_KEY) is a no-op: no timer, no send", async () => {
  const h = harness({ enabled: false });
  h.reporter.reportShown([A]);
  h.reporter.reportOpened(B);
  assert.equal(h.timers.length, 0);
  await h.reporter.flush();
  assert.equal(h.sent.length, 0);
});

test("an endpoint that is not deployed yet (404) pauses reporting for the long pause", async () => {
  const h = harness({ fail: () => new SubspaceJobsError("Jobs API /jobs/liveness-demand failed: 404", 404) });
  h.reporter.reportShown([A]);
  await h.reporter.flush();
  assert.equal(h.sent.length, 1);
  assert.match(h.logs[0], /pausing 600s/);

  h.advance(PAUSE_AFTER_REJECT_MS - 1);
  h.reporter.reportShown([B]);
  await h.reporter.flush();
  assert.equal(h.sent.length, 1, "nothing is even buffered while paused");

  h.advance(1);
  h.reporter.reportShown([A]);
  await h.reporter.flush();
  assert.equal(h.sent.length, 2, "a failed id was unmarked, so it is reported again after the pause");
});

test("a timeout or 5xx pauses only briefly, and stops the rest of that flush", async () => {
  let calls = 0;
  const h = harness({
    fail: () => (++calls === 1 ? new SubspaceJobsError("Timed out", undefined, "timeout") : null),
  });
  h.reporter.reportOpened(A);
  h.reporter.reportShown([B]);
  await h.reporter.flush();
  assert.deepEqual(h.sent, [{ ids: [A], urgent: true }], "the shown batch is dropped, not sent into a failing endpoint");
  assert.match(h.logs[0], /pausing 60s/);
  h.advance(PAUSE_AFTER_FAILURE_MS);
  h.reporter.reportShown([B]);
  await h.reporter.flush();
  assert.deepEqual(h.sent[1], { ids: [B], urgent: false });
});

test("a new flush window opens after each flush", async () => {
  const h = harness();
  h.reporter.reportShown([A]);
  await h.reporter.flush();
  h.reporter.reportShown([B]);
  assert.equal(h.timers.length, 2);
});

test("postLivenessDemand posts { ids, urgent } to /jobs/liveness-demand with the server key", async () => {
  const { postLivenessDemand } = await import("../../src/lib/jobs/subspaceJobs");
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SUBSPACE_API_KEY;
  const originalBase = process.env.SUBSPACE_API_BASE_URL;
  process.env.SUBSPACE_API_KEY = "test-key";
  process.env.SUBSPACE_API_BASE_URL = "https://subspace.test/api/v1/";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: { recorded: 2 } }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await postLivenessDemand([A, B], true, { timeoutMs: 3000 }), 2);
    assert.equal(await postLivenessDemand([], false), 0, "an empty batch makes no request");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://subspace.test/api/v1/jobs/liveness-demand");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal((calls[0].init?.headers as Record<string, string>)["x-api-key"], "test-key");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { ids: [A, B], urgent: true });
    assert.ok(calls[0].init?.signal, "the request carries its deadline");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SUBSPACE_API_KEY;
    else process.env.SUBSPACE_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.SUBSPACE_API_BASE_URL;
    else process.env.SUBSPACE_API_BASE_URL = originalBase;
  }
});
