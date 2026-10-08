/**
 * Velai's production entrypoint (Dockerfile CMD), run beside Next.js's
 * standalone `server.js`.
 *
 * A Next.js server is one JavaScript thread. On a local production build
 * (2026-10-07) one server pinned to one CPU answered about 48 requests a
 * second, and 1000 simulated visitors pushed the front door's median to
 * 14.5 s with a third of all requests over 5 s. So this starts
 * `WEB_CONCURRENCY` servers on private ports (PORT+1, PORT+2, ...) and
 * answers PORT itself, passing each request to one of them by visitor
 * (scripts/web-pool.mjs): the same visitor always reaches the same server,
 * so the per-visitor limits in src/lib/shield/rate-limit.ts count exactly
 * what they did with one server, and viewer sessions stay on the first.
 *
 * The count is capped by the container's CPUs and memory (768 MB a server),
 * and each server's heap is capped, so a leak restarts one server instead of
 * filling the box. A server that exits is started again; while it is down,
 * its visitors go to the next server. With one server (WEB_CONCURRENCY unset
 * or 1) this runs `server.js` in this process, exactly as before.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKER_HEAP_MB, clientKey, parseCpuMax, parseMemoryMax, pickWorker, resolveWorkerCount, withoutHopHeaders } from "./web-pool.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverJs = path.join(here, "server.js");

function readOr(file) {
    try {
        return readFileSync(file, "utf8");
    } catch {
        return null;
    }
}

const cpus = parseCpuMax(readOr("/sys/fs/cgroup/cpu.max")) ?? os.availableParallelism();
const memoryBytes = Math.min(parseMemoryMax(readOr("/sys/fs/cgroup/memory.max")) ?? Infinity, os.totalmem());
const count = resolveWorkerCount({ requested: process.env.WEB_CONCURRENCY, cpus, memoryBytes });

if (count === 1) {
    // Said either way, so a deploy shows whether the container's limits held it to one.
    console.log(`[start-web] 1 server (cpus ${cpus}, memory ${Math.round(memoryBytes / 2 ** 20)} MB, requested ${process.env.WEB_CONCURRENCY ?? "unset"})`);
    await import(serverJs);
} else {
    startPool(count);
}

function startPool(n) {
    const publicPort = Number.parseInt(process.env.PORT ?? "", 10) || 3000;
    const publicHost = process.env.HOSTNAME || "0.0.0.0";
    const heapFlag = /--max-old-space-size/.test(process.env.NODE_OPTIONS ?? "") ? "" : ` --max-old-space-size=${WORKER_HEAP_MB}`;
    const workers = Array.from({ length: n }, (_, i) => ({ index: i, port: publicPort + 1 + i, child: null, ready: false, startedAt: 0, backoffMs: 1000 }));
    const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity, maxFreeSockets: 256 });
    let stopping = false;
    let listening = false;

    console.log(`[start-web] ${n} servers on 127.0.0.1:${workers[0].port}-${workers[n - 1].port} behind :${publicPort} (cpus ${cpus}, memory ${Math.round(memoryBytes / 2 ** 20)} MB, requested ${process.env.WEB_CONCURRENCY ?? "unset"})`);

    function spawnWorker(w) {
        w.ready = false;
        w.startedAt = Date.now();
        w.child = spawn(process.execPath, [serverJs], {
            stdio: "inherit",
            // 0.0.0.0, as the Dockerfile sets for one server: bound to 127.0.0.1,
            // Next.js proxies its own middleware rewrites (front door, phone
            // first rows) to https://localhost and they answer 500 behind Caddy.
            // Only :PORT is published, so the private ports stay in the container.
            env: { ...process.env, PORT: String(w.port), HOSTNAME: "0.0.0.0", NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""}${heapFlag}`.trim() },
        });
        w.child.on("exit", (code, signal) => {
            w.ready = false;
            w.child = null;
            if (stopping) return;
            // A server that ran a while starts again at once; one that keeps dying waits longer each time.
            if (Date.now() - w.startedAt > 60_000) w.backoffMs = 1000;
            console.error(`[start-web] server ${w.index} exited (${signal ?? code}); starting again in ${w.backoffMs} ms`);
            setTimeout(() => spawnWorker(w), w.backoffMs);
            w.backoffMs = Math.min(w.backoffMs * 2, 30_000);
        });
        waitUntilListening(w);
    }

    function waitUntilListening(w) {
        const child = w.child;
        const probe = () => {
            if (stopping || w.child !== child || !child) return;
            const sock = net.connect(w.port, "127.0.0.1");
            sock.once("connect", () => {
                sock.destroy();
                w.ready = true;
                if (!listening) listen();
            });
            sock.once("error", () => {
                sock.destroy();
                setTimeout(probe, 250);
            });
        };
        probe();
    }

    function forward(req, res, retried) {
        const idx = pickWorker({ url: req.url, key: clientKey(req.headers, req.socket.remoteAddress), ready: workers.map((w) => w.ready) });
        if (idx < 0) {
            res.writeHead(503, { "content-type": "text/plain", "retry-after": "2" });
            res.end("Starting up");
            return;
        }
        const w = workers[idx];
        const upstream = http.request(
            { host: "127.0.0.1", port: w.port, method: req.method, path: req.url, headers: withoutHopHeaders(req.headers), agent },
            (upRes) => {
                res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, withoutHopHeaders(upRes.headers));
                upRes.pipe(res);
                upRes.on("error", () => res.destroy());
            },
        );
        upstream.on("error", (err) => {
            // Refused means that server is down: take it out until it listens again.
            const refused = err.code === "ECONNREFUSED";
            if (refused && w.ready) {
                w.ready = false;
                waitUntilListening(w);
            }
            if (res.headersSent) {
                res.destroy();
                return;
            }
            // Nothing reached that server, and a read has no body to replay: the next server answers it.
            if (refused && !retried && (req.method === "GET" || req.method === "HEAD")) {
                forward(req, res, true);
                return;
            }
            res.writeHead(502, { "content-type": "text/plain" });
            res.end("Bad gateway");
        });
        // The visitor left: stop the work on their behalf.
        res.on("close", () => {
            if (!res.writableFinished) upstream.destroy();
        });
        if (req.method === "GET" || req.method === "HEAD") upstream.end();
        else req.pipe(upstream);
    }

    const server = http.createServer((req, res) => forward(req, res, false));
    // Longer than the reverse proxy in front keeps idle connections, so it
    // never sends a request down a connection this side just closed.
    server.keepAliveTimeout = 130_000;
    server.headersTimeout = 131_000;

    function listen() {
        listening = true;
        server.listen(publicPort, publicHost, () => console.log(`[start-web] listening on ${publicHost}:${publicPort}`));
    }

    function stop(signal) {
        if (stopping) return;
        stopping = true;
        server.close();
        for (const w of workers) w.child?.kill(signal);
        const deadline = setTimeout(() => {
            for (const w of workers) w.child?.kill("SIGKILL");
            process.exit(0);
        }, 20_000);
        deadline.unref();
        const check = setInterval(() => {
            if (workers.every((w) => !w.child)) {
                clearInterval(check);
                process.exit(0);
            }
        }, 100);
    }
    process.on("SIGTERM", () => stop("SIGTERM"));
    process.on("SIGINT", () => stop("SIGINT"));

    for (const w of workers) spawnWorker(w);
}
