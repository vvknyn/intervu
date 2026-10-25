import assert from "node:assert/strict";
import { test } from "node:test";
import { eventLoopLine, upstreamErrorLine, visitorLeftLine } from "../../scripts/event-loop-delay.mjs";

const ms = (n: number) => n * 1e6; // histogram values are nanoseconds

test("quiet window logs nothing", () => {
    assert.equal(eventLoopLine("proxy", { max: ms(40), p99: ms(25), mean: ms(21) }), null);
});

test("a long single block (max over 1000 ms) logs", () => {
    assert.equal(eventLoopLine("worker-3002", { max: ms(52_800.4), p99: ms(30), mean: ms(900) }), "[eld] role=worker-3002 max=52800ms p99=30ms mean=900ms");
});

test("sustained lag (p99 over 250 ms, max under 1000 ms) logs", () => {
    assert.equal(eventLoopLine("proxy", { max: ms(600), p99: ms(251), mean: ms(80) }), "[eld] role=proxy max=600ms p99=251ms mean=80ms");
});

test("exactly at both thresholds stays silent", () => {
    assert.equal(eventLoopLine("proxy", { max: ms(1000), p99: ms(250), mean: ms(20) }), null);
});

test("upstream error line has code, port, method, path without query, elapsed", () => {
    assert.equal(upstreamErrorLine({ code: "ECONNRESET", port: 3002, method: "POST", url: "/jobs?email=a@b.c&q=x", elapsedMs: 53012.7 }), "[proxy] upstream_error code=ECONNRESET port=3002 POST /jobs 53013ms");
});

test("upstream error without a code, and a bare-query url", () => {
    assert.equal(upstreamErrorLine({ code: undefined, port: 3001, method: "GET", url: "?a=1", elapsedMs: 5 }), "[proxy] upstream_error code=unknown port=3001 GET / 5ms");
});

test("visitor left line has port, method, path without query, elapsed, and no error code", () => {
    assert.equal(visitorLeftLine({ port: 3001, method: "GET", url: "/co/x?q=a@b.c", elapsedMs: 10222.4 }), "[proxy] visitor_left port=3001 GET /co/x 10222ms");
});
