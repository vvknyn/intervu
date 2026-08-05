#!/usr/bin/env node
/**
 * Streams the tab the OpenClaw agent is driving to the user's phone.
 *
 * Prints the watch URL on stdout prefixed `WATCH-LAN:` (same WiFi) or
 * `WATCH:` (reachable anywhere). The skill greps for those prefixes and
 * sends one over WhatsApp — the channel that is already paired, which is
 * why getting a link onto the phone needs no setup at all.
 *
 * Lifecycle belongs to the skill: started when form-filling begins, stopped
 * at handoff. Nothing listens while no application is in flight.
 *
 * Usage:  node scripts/viewer.mjs
 */

import { randomBytes } from "node:crypto";
import { listPageTargets, pickActiveTarget, DEFAULT_CDP_BASE } from "./viewer/cdp-targets.mjs";
import { createFramePump } from "./viewer/frame-pump.mjs";
import { createLanTransport } from "./viewer/transport-lan.mjs";

const CDP_BASE = process.env.OPENCLAW_CDP_URL || DEFAULT_CDP_BASE;

async function main() {
    const target = pickActiveTarget(await listPageTargets(CDP_BASE));
    if (!target) {
        console.error(`No open Chrome tab at ${CDP_BASE}. Open the application form first, then start the viewer.`);
        process.exit(1);
    }

    const transports = [];
    const lan = createLanTransport({ token: randomBytes(24).toString("base64url") });
    const { url } = await lan.start();
    transports.push(lan);
    if (url) console.log(`WATCH-LAN: ${url}`);
    else console.error("No local network address found — this machine appears to be offline.");

    // What the phone draws is one frame plus the box to crop it to. Kept
    // here so a focus change can re-send the last frame: on a page that is
    // not changing, no new frame is coming, and the view would otherwise
    // stay stuck on the whole page after focus is discovered.
    let lastFrameData = null;
    let focus = { dw: null, r: null };

    const publish = () => {
        if (!lastFrameData) return;
        const payload = JSON.stringify({ f: lastFrameData, r: focus.r, dw: focus.dw });
        for (const t of transports) t.sendFrame(payload);
    };

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const pump = createFramePump({
        send: (message) => socket.send(JSON.stringify(message)),
        onFrame: (frame) => { lastFrameData = frame.data; publish(); },
        onFocus: (next) => {
            const incoming = next ?? { dw: focus.dw, r: null };
            if (JSON.stringify(incoming) === JSON.stringify(focus)) return;
            focus = incoming;
            publish();
        },
    });

    const FOCUS_POLL_MS = 400;
    let focusTimer = null;
    socket.addEventListener("open", () => {
        pump.start();
        focusTimer = setInterval(() => pump.pollFocus(), FOCUS_POLL_MS);
    });
    socket.addEventListener("message", (event) => pump.handle(JSON.parse(event.data)));
    socket.addEventListener("error", () => {
        console.error(`Lost the connection to Chrome (tab ${target.id}).`);
        process.exit(1);
    });

    const shutdown = async () => {
        if (focusTimer) clearInterval(focusTimer);
        await Promise.allSettled(transports.map((t) => t.close()));
        socket.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
