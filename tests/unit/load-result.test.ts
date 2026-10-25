import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    loaded,
    loadFailed,
    readWithRetry,
    retryDelayMs,
    RETRY_BASE_MS,
    RETRY_JITTER_MS,
    settleAction,
    settleEnvelope,
    ACTION_CEILING_MS,
    type LoadResult,
} from "@/lib/load-result";
import { createServerListCache } from "@/lib/server-list-cache";
import { EXEMPT_MARKER, findFailureAsEmpty } from "../../scripts/lib/failure-as-empty-gate.mjs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walkTsxFiles } = require("../../scripts/design/banned-classes.cjs") as {
    walkTsxFiles: (dir: string) => string[];
};

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const noSleep = async () => {};

test("settleEnvelope: an empty list is a result, a failure is not an empty list", async () => {
    assert.deepEqual(await settleEnvelope(Promise.resolve({ data: [] })), { ok: true, data: [] });
    assert.deepEqual(await settleEnvelope(Promise.resolve({ data: [1, 2] })), { ok: true, data: [1, 2] });
    assert.deepEqual(await settleEnvelope(Promise.resolve({ error: "User not authenticated" })), {
        ok: false,
        error: "User not authenticated",
    });
    // A 503 on a Server Action POST surfaces as a thrown error in the client.
    const r503 = await settleEnvelope(Promise.reject(new Error("An unexpected response was received from the server.")));
    assert.equal(r503.ok, false);
    assert.equal((await settleEnvelope(Promise.resolve({}))).ok, false, "no data and no error is not an empty list");
});

test("retryDelayMs: jittered inside [base, base + jitter)", () => {
    assert.equal(retryDelayMs(() => 0), RETRY_BASE_MS);
    assert.equal(retryDelayMs(() => 0.999999), RETRY_BASE_MS + RETRY_JITTER_MS - 1);
    assert.notEqual(retryDelayMs(() => 0.1), retryDelayMs(() => 0.9));
});

test("readWithRetry: exactly one automatic retry, then the failure reaches the caller", async () => {
    let calls = 0;
    const alwaysFails = async (): Promise<LoadResult<number[]>> => {
        calls += 1;
        return loadFailed(new Error("503"));
    };
    const slept: number[] = [];
    const r = await readWithRetry(alwaysFails, async (ms) => void slept.push(ms));
    assert.equal(r.ok, false);
    assert.equal(calls, 2);
    assert.equal(slept.length, 1);
    assert.ok(slept[0] >= RETRY_BASE_MS && slept[0] < RETRY_BASE_MS + RETRY_JITTER_MS);

    let n = 0;
    const flaky = async () => (++n === 1 ? loadFailed("503") : loaded(["row"]));
    assert.deepEqual(await readWithRetry(flaky, noSleep), { ok: true, data: ["row"] });

    let okCalls = 0;
    await readWithRetry(async () => (okCalls++, loaded([])), noSleep);
    assert.equal(okCalls, 1, "an ok (even empty) read is never retried");
});

// The /yours tracker, history, follows and saved-search reads — a surface
// other than For-you — share this cache. A failed read must not be cached as
// `[]` for the session (the old hooks' `.catch(() => { cache = []; })`).
test("createServerListCache: failure is not cached, Retry re-reads, success is cached", async () => {
    const responses: Array<() => Promise<{ data?: string[]; error?: string }>> = [
        () => Promise.reject(new Error("503")),
        () => Promise.resolve({ error: "Failed to fetch applications" }),
        () => Promise.resolve({ data: ["pursuit-1"] }),
    ];
    let calls = 0;
    const cache = createServerListCache<string>(() => responses[calls++]());
    let notified = 0;
    cache.subscribe(() => notified++);

    // readWithRetry sleeps 2-4 s between attempts; patch timers for the test.
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as typeof setTimeout;
    try {
        const first = await cache.fetch();
        assert.equal(first.ok, false);
        assert.equal(calls, 2, "one automatic retry");
        assert.equal(cache.peek(), null, "a failure is not cached");

        cache.invalidate(); // what the Retry button calls
        assert.equal(notified, 1);
        assert.deepEqual(await cache.fetch(), { ok: true, data: ["pursuit-1"] });
        assert.deepEqual(cache.peek(), ["pursuit-1"]);
        await cache.fetch();
        assert.equal(calls, 3, "a success is served from cache");
    } finally {
        globalThis.setTimeout = realSetTimeout;
    }
});

test("every list surface renders LoadFailedState before its empty state", () => {
    const surfaces: Array<[string, RegExp]> = [
        ["src/app/jobs/JobsContent.tsx", /resultsPanel === "error" \?[\s\S]*?<LoadFailedState/],
        ["src/app/yours/page.tsx", /failed \?[\s\S]*<LoadFailedState[\s\S]*<TrackerEmptyState/],
        ["src/app/yours/history/page.tsx", /failed\) \{[\s\S]*<LoadFailedState[\s\S]*<HistoryEmptyState/],
        ["src/app/yours/[id]/page.tsx", /!pursuit && failed[\s\S]*<LoadFailedState[\s\S]*pursuit-not-found/],
    ];
    for (const [file, re] of surfaces) assert.match(read(file), re, file);
});

test("gate: no client module collapses a failed read into an empty value", () => {
    const offenders: string[] = [];
    for (const file of walkTsxFiles(path.join(ROOT, "src"))) {
        for (const hit of findFailureAsEmpty(readFileSync(file, "utf8"))) {
            offenders.push(`${path.relative(ROOT, file)}:${hit.line} ${hit.text}`);
        }
    }
    assert.deepEqual(offenders, [], `settle to LoadResult (src/lib/load-result.ts), or mark the line \`${EXEMPT_MARKER} <reason>\``);
});

test("gate detector: flags every collapse shape, leaves server code, comments and marked lines alone", () => {
    const client = (body: string) => `"use client";\n${body}`;
    const lines = (src: string) => findFailureAsEmpty(src).map((h) => h.line);
    // The shape that shipped in four account-list hooks.
    assert.deepEqual(
        lines(client(`inflight = act()\n  .then((res) => {\n    cache = res.data ?? [];\n  })\n  .catch(() => {\n    cache = [];\n    return cache;\n  });`)),
        [4, 6],
    );
    assert.deepEqual(lines(client(`const rows = await act().catch(() => []);`)), [2]);
    assert.deepEqual(lines(client(`const counts = await act().catch(() => ({}));`)), [2]);
    assert.deepEqual(lines(client(`const n = await countAction().catch(() => 0);`)), [2]);
    assert.deepEqual(lines(client(`p.catch((e) => { return null; });`)), [2]);

    const none = (src: string) => assert.deepEqual(findFailureAsEmpty(src), [], src);
    none(`const body = await request.json().catch(() => null);`); // server route, not a client module
    none(client(`void save().catch(() => {});`)); // fire-and-forget write, nothing rendered from it
    none(client(`// used to be .catch(() => [])`));
    none(client(`setRows(res.data ?? []); // ${EXEMPT_MARKER} res.error was checked on the line above`));
    assert.equal(lines(client(`setRows(res.data ?? []); // ${EXEMPT_MARKER} ok`)).length, 1, "a reason is required");
});

// ── settleAction: a throw or a hang becomes the `{ error }` an action already returns ──

test("settleAction: a resolved result passes through untouched, error shape included", async () => {
    assert.deepEqual(await settleAction(Promise.resolve({ data: 3 })), { data: 3 });
    assert.deepEqual(await settleAction(Promise.resolve({ error: "nope", code: "X" })), { error: "nope", code: "X" });
});

test("settleAction: a thrown action (502 / network) becomes { error }", async () => {
    const res = await settleAction(Promise.reject<{ error?: string }>(new Error("Bad gateway")));
    assert.equal(res.error, "Bad gateway");
});

test("settleAction: a non-Error throw still becomes a string { error }", async () => {
    const res = await settleAction(Promise.reject<{ error?: string }>("boom"));
    assert.equal(res.error, "boom");
});

test("settleAction: a hang past the ceiling stops waiting and reports failure", async () => {
    const never = new Promise<{ error?: string }>(() => {});
    const res = await settleAction(never, 20);
    assert.match(res.error ?? "", /too long/i);
});

test("settleAction: a slow answer inside the ceiling still wins", async () => {
    const slow = new Promise<{ data: number }>((r) => setTimeout(() => r({ data: 1 }), 5));
    assert.deepEqual(await settleAction(slow, 200), { data: 1 });
});

test("settleEnvelope: a hang past the ceiling is a failed load, not endless loading", async () => {
    const res = await settleEnvelope(new Promise(() => {}), 20);
    assert.equal(res.ok, false);
});

test("ceiling is longer than the patience line (8 s) and shorter than the 53 s stall seen on prod", () => {
    assert.ok(ACTION_CEILING_MS > 8_000 && ACTION_CEILING_MS < 53_000);
});
