/**
 * Stall diagnosis (2026-10-25: the whole web pool stalled ~53 s while the
 * container waited on CPU only ~18%). Each process (the proxy in
 * start-web.mjs, each Next worker via src/instrumentation.ts) samples its own
 * event-loop delay and logs one line per minute only when the loop was
 * blocked, so a stall says which process blocked and for how long.
 * Plain ESM, shared by both: the Dockerfile copies it beside start-web.mjs.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";

const WINDOW_MS = 60_000;
const MAX_MS = 1000; // one block this long is a visible stall
const P99_MS = 250; // sustained lag below that is still a bad minute

const toMs = (ns) => Math.round(ns / 1e6);

/** The log line for one window's histogram (nanoseconds), or null when the loop was healthy. */
export function eventLoopLine(role, { max, p99, mean }) {
    if (max / 1e6 <= MAX_MS && p99 / 1e6 <= P99_MS) return null;
    return `[eld] role=${role} max=${toMs(max)}ms p99=${toMs(p99)}ms mean=${toMs(mean)}ms`;
}

/** The proxy's request-outcome lines share one shape. Path only: the query string may carry personal data. */
function proxyLine(event, detail, { port, method, url, elapsedMs }) {
    const pathOnly = url.split("?")[0] || "/";
    return `[proxy] ${event} ${detail}port=${port} ${method} ${pathOnly} ${Math.round(elapsedMs)}ms`;
}

/** A server failed the request (refused, reset by the server, timed out). */
export function upstreamErrorLine({ code, ...rest }) {
    return proxyLine("upstream_error", `code=${code ?? "unknown"} `, rest);
}

/** The visitor closed the connection before the answer finished: not a server failure. */
export function visitorLeftLine(rest) {
    return proxyLine("visitor_left", "", rest);
}

/** Start sampling; logs through console.log (stdout, as the other [start-web] lines). */
export function startEventLoopMonitor(role) {
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    const timer = setInterval(() => {
        const line = eventLoopLine(role, { max: histogram.max, p99: histogram.percentile(99), mean: histogram.mean });
        histogram.reset();
        if (line) console.log(line);
    }, WINDOW_MS);
    timer.unref();
}
