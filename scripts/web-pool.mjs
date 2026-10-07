/**
 * The pure half of `start-web.mjs` (the production entrypoint): how many
 * Next.js servers to run, and which one serves a request. No I/O here, so
 * tests/unit/web-pool.test.ts covers it without starting anything.
 */

/** What one server needs to stay up under load: a single process reached 715 MB resident serving 1000 simulated visitors (2026-10-07, local production build). */
export const WORKER_MEMORY_BYTES = 768 * 1024 * 1024;
/** Heap cap per server (MB): a leak restarts one server instead of filling the box. */
export const WORKER_HEAP_MB = 768;
export const MAX_WORKERS = 8;

/**
 * How many servers to start: what `WEB_CONCURRENCY` asks for (1 when unset or
 * not a number), never more than the container's CPUs, and never more than
 * its memory holds at `WORKER_MEMORY_BYTES` each. Always at least 1.
 */
export function resolveWorkerCount({ requested, cpus, memoryBytes }) {
    const asked = Number.parseInt(String(requested ?? ""), 10);
    let n = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_WORKERS) : 1;
    if (Number.isFinite(cpus) && cpus > 0) n = Math.min(n, Math.max(1, Math.floor(cpus)));
    if (Number.isFinite(memoryBytes) && memoryBytes > 0) n = Math.min(n, Math.max(1, Math.floor(memoryBytes / WORKER_MEMORY_BYTES)));
    return n;
}

/** CPUs a cgroup v2 `cpu.max` line allows ("200000 100000" is 2), or null for "max" or anything unreadable. */
export function parseCpuMax(text) {
    const [quota, period] = String(text ?? "").trim().split(/\s+/);
    const q = Number(quota);
    const p = Number(period);
    return Number.isFinite(q) && Number.isFinite(p) && q > 0 && p > 0 ? q / p : null;
}

/** Bytes a cgroup v2 `memory.max` allows, or null for "max" or anything unreadable. */
export function parseMemoryMax(text) {
    const n = Number(String(text ?? "").trim());
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** 32-bit FNV-1a: a fast, stable string hash (the same visitor lands on the same server every time). */
export function hashKey(key) {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/**
 * Who is asking, by the same rule as src/lib/shield/client-ip.ts: Cloudflare's
 * CF-Connecting-IP, else the first X-Forwarded-For entry, else the socket peer.
 */
export function clientKey(headers, remoteAddress) {
    const cf = headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf.trim()) return cf.trim();
    const xff = headers["x-forwarded-for"];
    const first = typeof xff === "string" ? xff.split(",")[0]?.trim() : "";
    return first || remoteAddress || "";
}

/**
 * Viewer sessions live in one server's memory (src/lib/viewer/session-store.ts):
 * a session created on one server would 404 on another, so they all go to the first.
 */
export function pinnedToFirst(url) {
    return typeof url === "string" && url.startsWith("/api/viewer/");
}

/**
 * Which server takes this request: the first for viewer sessions, otherwise
 * one chosen by visitor, so each visitor's requests meet the same per-visitor
 * limits (src/lib/shield/rate-limit.ts) and caches every time. A server that
 * isn't up passes the request to the next one that is. -1 when none is up.
 */
export function pickWorker({ url, key, ready }) {
    const n = ready.length;
    if (n === 0) return -1;
    const start = pinnedToFirst(url) ? 0 : hashKey(key) % n;
    for (let i = 0; i < n; i++) {
        const idx = (start + i) % n;
        if (ready[idx]) return idx;
    }
    return -1;
}

/** Hop-by-hop headers (RFC 9110 §7.6.1): they describe one connection and are never passed on. */
const HOP_BY_HOP = ["connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "expect"];

/**
 * A copy of `headers` without hop-by-hop headers, including any the Connection
 * header names. Node re-frames each body itself (Content-Length when known,
 * else chunked), so dropping Transfer-Encoding loses nothing.
 */
export function withoutHopHeaders(headers) {
    const out = { ...headers };
    const named = typeof headers.connection === "string" ? headers.connection.split(",").map((s) => s.trim().toLowerCase()) : [];
    for (const h of [...HOP_BY_HOP, ...named]) delete out[h];
    return out;
}
