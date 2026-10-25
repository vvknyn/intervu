/**
 * scripts/web-pool.mjs: how many Next.js servers the production entrypoint
 * (scripts/start-web.mjs) starts, and which one serves each request.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as pool from "../../scripts/web-pool.mjs";

const GB = 1024 ** 3;

test("the count is what WEB_CONCURRENCY asks for, 1 when unset or not a number", () => {
    assert.equal(pool.resolveWorkerCount({ requested: "3", cpus: 8, memoryBytes: 24 * GB }), 3);
    assert.equal(pool.resolveWorkerCount({ requested: undefined, cpus: 8, memoryBytes: 24 * GB }), 1);
    assert.equal(pool.resolveWorkerCount({ requested: "lots", cpus: 8, memoryBytes: 24 * GB }), 1);
    assert.equal(pool.resolveWorkerCount({ requested: "0", cpus: 8, memoryBytes: 24 * GB }), 1);
    assert.equal(pool.resolveWorkerCount({ requested: "50", cpus: 64, memoryBytes: 256 * GB }), pool.MAX_WORKERS);
});

test("never more servers than the container's CPUs or memory hold", () => {
    assert.equal(pool.resolveWorkerCount({ requested: "3", cpus: 1, memoryBytes: 24 * GB }), 1, "one CPU");
    assert.equal(pool.resolveWorkerCount({ requested: "3", cpus: 2.5, memoryBytes: 24 * GB }), 2);
    assert.equal(pool.resolveWorkerCount({ requested: "3", cpus: 8, memoryBytes: 1 * GB }), 1, "a 1 GB container keeps one server");
    assert.equal(pool.resolveWorkerCount({ requested: "3", cpus: 8, memoryBytes: 2 * GB }), 2);
});

test("cgroup limits read as numbers, and 'max' reads as no limit", () => {
    assert.equal(pool.parseCpuMax("200000 100000\n"), 2);
    assert.equal(pool.parseCpuMax("max 100000"), null);
    assert.equal(pool.parseCpuMax(null), null);
    assert.equal(pool.parseMemoryMax("2147483648\n"), 2 * GB);
    assert.equal(pool.parseMemoryMax("max"), null);
});

test("a visitor always reaches the same server, so per-visitor limits count as with one server", () => {
    const ready = [true, true, true];
    const first = pool.pickWorker({ url: "/jobs", key: "203.0.113.7", ready });
    for (let i = 0; i < 20; i++) assert.equal(pool.pickWorker({ url: "/api/jobs/search", key: "203.0.113.7", ready }), first);
    const seen = new Set(Array.from({ length: 300 }, (_, i) => pool.pickWorker({ url: "/jobs", key: `198.51.100.${i}`, ready })));
    assert.deepEqual([...seen].sort(), [0, 1, 2], "visitors spread over every server");
});

test("viewer sessions all go to the first server, where they live", () => {
    for (let i = 0; i < 50; i++) assert.equal(pool.pickWorker({ url: "/api/viewer/session", key: `198.51.100.${i}`, ready: [true, true, true] }), 0);
});

test("a server that is down passes its visitors to the next one up; none up is -1", () => {
    const key = "203.0.113.7";
    const home = pool.pickWorker({ url: "/jobs", key, ready: [true, true, true] });
    const ready = [true, true, true];
    ready[home] = false;
    assert.equal(pool.pickWorker({ url: "/jobs", key, ready }), (home + 1) % 3);
    assert.equal(pool.pickWorker({ url: "/jobs", key, ready: [false, false, false] }), -1);
});

test("the visitor is read like src/lib/shield/client-ip.ts: Cloudflare's header, then the first forwarded address, then the socket", () => {
    assert.equal(pool.clientKey({ "cf-connecting-ip": " 203.0.113.7 ", "x-forwarded-for": "10.0.0.1" }, "172.18.0.2"), "203.0.113.7");
    assert.equal(pool.clientKey({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }, "172.18.0.2"), "198.51.100.4");
    assert.equal(pool.clientKey({}, "172.18.0.2"), "172.18.0.2");
});

test("hop-by-hop headers are not passed on; everything else is", () => {
    const out = pool.withoutHopHeaders({
        host: "velai.app",
        connection: "keep-alive, x-trace",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked",
        "x-trace": "1",
        "set-cookie": ["a=1", "b=2"],
        "cf-connecting-ip": "203.0.113.7",
    });
    assert.deepEqual(out, { host: "velai.app", "set-cookie": ["a=1", "b=2"], "cf-connecting-ip": "203.0.113.7" });
});

test("a retried request keeps its first arrival time; a new request gets its own", () => {
    const retried = {};
    assert.equal(pool.stampArrival(retried, 1000), 1000);
    assert.equal(pool.stampArrival(retried, 1400), 1000, "retry: the logged elapsed covers every attempt");
    const other = {};
    assert.equal(pool.stampArrival(other, 1500), 1500, "not a retry: its own time, not the earlier request's");
    assert.equal(pool.stampArrival(retried, 1600), 1000);
});
