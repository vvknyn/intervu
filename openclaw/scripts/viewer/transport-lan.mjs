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

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "watch-page.html"), "utf8");

export function lanUrls(port, token, ifaces = networkInterfaces()) {
    return Object.values(ifaces)
        .flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal)
        .map((i) => `http://${i.address}:${port}/?t=${token}`);
}

export function createLanTransport({ port = 18801, token }) {
    const clients = new Set();
    let server = null;

    const handler = (req, res) => {
        const url = new URL(req.url, "http://localhost");
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
