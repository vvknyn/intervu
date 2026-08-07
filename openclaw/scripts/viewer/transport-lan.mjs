/**
 * Same-WiFi (and, once Tailscale is up, same-tailnet) transport: Server-Sent
 * Events downstream for frames, plain POST upstream for input. Two separate
 * primitives rather than one WebSocket because SSE-plus-POST needs no
 * dependency at all and no handshake beyond the token in the URL — the
 * asymmetry (many small POSTs vs. one long-lived stream) matches how the
 * two directions are actually shaped.
 *
 * The token is the whole access control here. It is generated per run and
 * carried in the URL, so the link the user receives is the credential and
 * a link from a finished session is worthless.
 *
 * The token alone is not enough to authorize CONTROL, though: this product
 * installs on other people's networks (cafés, offices — anywhere with a
 * plain shared WiFi), and a link that leaked or was screen-shared on that
 * network would otherwise let a stranger drive the agent's browser. Input
 * is only honored when the connection itself arrived over the tailnet
 * interface (`isControlCapable`, keyed off the request's local address) —
 * same-WiFi connections stay watch-only, and the page is told so up front
 * so it never shows a "take control" button it can't honor.
 */

import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isTailnetAddress, isTailnetConnection } from "./tailnet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, "watch-page.html"), "utf8");
// Served rather than inlined so the crop/input arithmetic each has exactly
// one home and stays unit-testable in Node.
const CROP_MODULE = readFileSync(join(HERE, "crop.mjs"), "utf8");
const INPUT_CAPTURE_MODULE = readFileSync(join(HERE, "input-capture.mjs"), "utf8");

/** The page's control button must render only when this same request's
 *  connection is control-capable — stamped in as a global before the page's
 *  own module script runs, so the client never has to guess or race a
 *  separate fetch to find out. */
const CONTROL_SCRIPT_ANCHOR = '<script type="module">';

/** Larger than any legitimate wire message (tap/text/key control messages
 *  are at most a couple KB); caps how much of a POST /input body this
 *  server will buffer before the sink ever sees it, so a client posting an
 *  oversized body cannot make it spend unbounded memory assembling garbage. */
export const MAX_INPUT_BYTES = 64 * 1024;

/**
 * Only three fields of an interface record matter here, so that is all the
 * parameter promises — which keeps a test free to hand over a plain literal
 * instead of a full os.NetworkInterfaceInfo.
 *
 * A Tailscale interface is labeled separately from a plain LAN one: it is
 * the one link that keeps working off WiFi, so the skill needs to tell it
 * apart from an address that only reaches the same room.
 *
 * @param {number} port
 * @param {string} token
 * @param {Record<string, Array<{ family: string, internal: boolean, address: string }> | undefined>} [ifaces]
 * @returns {Array<{ kind: "tailnet" | "lan", url: string }>}
 */
export function lanUrls(port, token, ifaces = networkInterfaces()) {
    return Object.values(ifaces)
        .flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal)
        .map((i) => ({
            kind: isTailnetAddress(i.address) ? "tailnet" : "lan",
            url: `http://${i.address}:${port}/?t=${token}`,
        }));
}

/**
 * @param {object} deps
 * @param {number} [deps.port]
 * @param {string} [deps.host]  bind address; only ever overridden by a test
 *  (see MAX_INPUT_BYTES's sibling `port` param for the same rationale).
 * @param {string} deps.token
 * @param {(text: string, source: "lan") => void} deps.onInput
 * @param {() => void} [deps.onDisconnect]  called when a client (the /stream
 *  subscriber) disconnects, so the caller can re-arm its input-sink gate.
 * @param {(localAddress: string | undefined) => boolean} [deps.isControlCapable]
 */
export function createLanTransport({ port = 18801, host = undefined, token, onInput, onDisconnect = undefined, isControlCapable = isTailnetConnection }) {
    const clients = new Set();
    let server = null;
    // SSE has no replay and Chrome only emits on change, so a phone that
    // connects between changes would otherwise see nothing. Holding the most
    // recent frame means any subscriber, at any moment, opens onto the
    // current screen.
    let lastFrame = null;

    const handler = (req, res) => {
        const url = new URL(req.url, "http://localhost");

        // Ahead of the token gate on purpose. A browser resolves the page's
        // `./crop.mjs` import with no query string, so a module request
        // cannot carry the token; gating it makes the import 403, which kills
        // the entire module script and leaves the page silently stuck. The
        // token exists to protect the SCREEN — this file is arithmetic and
        // contains nothing about the user.
        if (url.pathname === "/crop.mjs") {
            res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
            return res.end(CROP_MODULE);
        }
        if (url.pathname === "/input-capture.mjs") {
            res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
            return res.end(INPUT_CAPTURE_MODULE);
        }
        // Browsers request this on their own; 403-ing it puts a red error in
        // the console that has nothing to do with any real problem.
        if (url.pathname === "/favicon.ico") {
            res.writeHead(204);
            return res.end();
        }

        if (url.searchParams.get("t") !== token) {
            // A bare "forbidden" is indistinguishable from a broken feature.
            // The overwhelmingly likely cause is a link that lost characters
            // in transit or was retyped by hand — the token is 32 characters
            // of base64url and ends in things like `-` or `_` — so say that,
            // and say what to do about it.
            res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
            return res.end(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link not valid</title>
<style>body{margin:0;background:#111;color:#eee;font:16px/1.5 -apple-system,system-ui,sans-serif;
display:grid;place-items:center;min-height:100dvh;padding:24px;text-align:center}
p{max-width:30ch;color:#aaa;font-size:14px}</style>
<div><h1 style="font-size:18px;margin:0 0 8px">This watch link isn't valid</h1>
<p>It was probably cut short on the way here — the link ends in a random code that has to arrive whole.
Ask your agent for a fresh link, and open it by tapping rather than retyping.</p></div>`);
        }
        if (url.pathname === "/stream") {
            res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                connection: "keep-alive",
            });
            res.write(": connected\n\n");
            if (lastFrame) res.write(`data: ${lastFrame}\n\n`);
            clients.add(res);
            req.on("close", () => {
                clients.delete(res);
                // Re-arms the input gate: without this, a phone that reloads
                // (a fresh page, control shown off) leaves the OLD sink
                // thinking control is still on, and a stray POST /input
                // carrying the still-valid LAN token would be honored with
                // nobody having granted it on the page now showing.
                onDisconnect?.();
            });
            return;
        }
        if (url.pathname === "/input" && req.method === "POST") {
            // Same-WiFi links are watch-only: this product installs on
            // networks we don't control, so input is only honored when the
            // connection itself arrived over the tailnet interface — the
            // token proves the link is genuine, not that this network is
            // trusted with control.
            if (!isControlCapable(req.socket.localAddress)) {
                res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
                return res.end("Control isn't available on this link — it only works over the tailnet (WATCH-ANYWHERE) link.");
            }
            // Never parsed here — the sink is the only place the wire
            // contract is validated, so every transport hands over the same
            // raw text regardless of what shape (or non-JSON garbage) it is.
            let body = "";
            let bytes = 0;
            let rejected = false;
            req.on("data", (chunk) => {
                if (rejected) return;
                bytes += chunk.length;
                if (bytes > MAX_INPUT_BYTES) {
                    rejected = true;
                    res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
                    res.end("Input message too large.");
                    req.destroy();
                    return;
                }
                body += chunk;
            });
            req.on("end", () => {
                if (rejected) return;
                onInput?.(body, "lan");
                res.writeHead(204);
                res.end();
            });
            return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        const capable = isControlCapable(req.socket.localAddress);
        res.end(PAGE.replace(CONTROL_SCRIPT_ANCHOR, `<script>window.__CONTROL_CAPABLE__=${capable};</script>\n${CONTROL_SCRIPT_ANCHOR}`));
    };

    return {
        /**
         * Falls back to an ephemeral port when the preferred one is taken.
         *
         * A second application being prepared while the first is still open
         * would otherwise die on EADDRINUSE — and as an unhandled 'error'
         * event, meaning a raw stack trace and no watch link at all. Nothing
         * depends on the port number: it travels inside the URL, and the
         * token changes every run, so there is nothing to bookmark.
         */
        async start() {
            server = createServer(handler);
            await new Promise((resolve, reject) => {
                server.once("error", (err) => {
                    // A non-EADDRINUSE error (EACCES on a privileged port,
                    // ENOTFOUND on a bad host, ...) used to `throw` here —
                    // inside an async event callback, which the enclosing
                    // Promise cannot catch, so it became an uncaught
                    // exception that killed the whole process instead of a
                    // clean, reportable start() rejection.
                    if (err.code !== "EADDRINUSE") return reject(err);
                    console.error(`Port ${port} is busy (another application is probably still open) — using a free one instead.`);
                    server.listen(0, host, () => resolve());
                });
                server.listen(port, host, () => resolve());
            });
            return { urls: lanUrls(server.address().port, token) };
        },

        port() {
            return server?.address()?.port ?? null;
        },

        sendFrame(base64) {
            lastFrame = base64;
            for (const res of clients) res.write(`data: ${base64}\n\n`);
        },

        async close() {
            for (const res of clients) res.end();
            clients.clear();
            if (server) await new Promise((resolve) => server.close(resolve));
            server = null;
        },
    };
}
