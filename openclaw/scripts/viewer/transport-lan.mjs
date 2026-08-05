/**
 * Same-WiFi transport: Server-Sent Events over plain node:http.
 *
 * No WebSocket library and no dependency at all, which is only possible
 * because v1 is watch-only and therefore one-way. When input forwarding
 * lands this has to become a duplex channel and will need a real socket —
 * that is a v2 change, not a hook to leave lying around now.
 *
 * The token is the whole access control here. It is generated per run and
 * carried in the URL, so the link the user receives is the credential and
 * a link from a finished session is worthless.
 */

import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, "watch-page.html"), "utf8");
// Served rather than inlined so the crop arithmetic has exactly one home and
// stays unit-testable in Node.
const CROP_MODULE = readFileSync(join(HERE, "crop.mjs"), "utf8");

/**
 * Only three fields of an interface record matter here, so that is all the
 * parameter promises — which keeps a test free to hand over a plain literal
 * instead of a full os.NetworkInterfaceInfo.
 *
 * @param {number} port
 * @param {string} token
 * @param {Record<string, Array<{ family: string, internal: boolean, address: string }> | undefined>} [ifaces]
 * @returns {string[]}
 */
export function lanUrls(port, token, ifaces = networkInterfaces()) {
    return Object.values(ifaces)
        .flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal)
        .map((i) => `http://${i.address}:${port}/?t=${token}`);
}

export function createLanTransport({ port = 18801, token }) {
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
            req.on("close", () => clients.delete(res));
            return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE);
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
            const bound = await new Promise((resolve) => {
                server.once("error", (err) => {
                    if (err.code !== "EADDRINUSE") throw err;
                    console.error(`Port ${port} is busy (another application is probably still open) — using a free one instead.`);
                    server.listen(0, () => resolve(true));
                });
                server.listen(port, () => resolve(true));
            });
            if (!bound) throw new Error("the viewer's local server failed to start");
            return { url: lanUrls(server.address().port, token)[0] ?? null };
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
