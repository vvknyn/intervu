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
            res.writeHead(403, { "content-type": "text/plain" });
            return res.end("forbidden");
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
        async start() {
            server = createServer(handler);
            await new Promise((resolve) => server.listen(port, resolve));
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
