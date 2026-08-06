#!/usr/bin/env node
/**
 * Streams the tab the OpenClaw agent is driving to the user's phone.
 *
 * Prints exactly one watch URL per run, best-first: `WATCH-ANYWHERE:`
 * (tailnet, once setup is verified) then `WATCH:` (doorbell) then
 * `WATCH-LAN:` (same WiFi) — the skill picks whichever prefix it finds and
 * sends that one over WhatsApp, the channel already paired with the phone.
 * When a tailnet address exists but setup has never been verified,
 * `SETUP-OFFER: tailnet` is printed instead so the skill can make the
 * one-time offer rather than silently never mentioning the option.
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
import { createWebRtcTransport } from "./viewer/transport-webrtc.mjs";
import { createInputSink } from "./viewer/input-sink.mjs";
import { tailnetReady } from "./viewer/tailnet.mjs";
import { readAccessToken } from "./viewer/mcporter-token.mjs";

const CDP_BASE = process.env.OPENCLAW_CDP_URL || DEFAULT_CDP_BASE;
const API_BASE = process.env.INTERVU_API_BASE || "https://intervu.cc";
const MCP_SERVER_KEY = "intervu-cc-mcp";

async function main() {
    const target = pickActiveTarget(await listPageTargets(CDP_BASE));
    if (!target) {
        console.error(`No open Chrome tab at ${CDP_BASE}. Open the application form first, then start the viewer.`);
        process.exit(1);
    }

    // Declared before the transports so the input sink — which every
    // transport feeds via onInput — can close over the CDP socket and the
    // live device width without waiting for the pump setup further down.
    let socket;
    let focus = { dw: null, r: null };
    const sink = createInputSink({
        send: (message) => socket.send(JSON.stringify(message)),
        deviceWidth: () => focus.dw,
    });
    const onInput = (text) => sink.handle(text);

    const transports = [];
    const lan = createLanTransport({ token: randomBytes(24).toString("base64url"), onInput });
    const { urls } = await lan.start();
    transports.push(lan);
    const lanUrl = urls.find((u) => u.kind === "lan");
    const tailnetUrl = urls.find((u) => u.kind === "tailnet");
    if (lanUrl) console.log(`WATCH-LAN: ${lanUrl.url}`);
    else console.error("No local network address found — this machine appears to be offline.");
    if (tailnetUrl) {
        // Only claimed once setup is verified — an unverified tailnet
        // address is not evidence the PHONE is on the tailnet too.
        if (tailnetReady()) console.log(`WATCH-ANYWHERE: ${tailnetUrl.url}`);
        else console.log("SETUP-OFFER: tailnet");
    }

    // Remote viewing is best-effort by design: it depends on a credential
    // that can expire and on a peer connection the network may refuse. When
    // it is unavailable the same-WiFi link above still works, so this must
    // never take the apply loop down — but it says exactly why, because a
    // feature that vanishes without explanation is worse than one that fails.
    const bearer = readAccessToken(MCP_SERVER_KEY);
    if (!bearer) {
        console.error(`Remote viewing unavailable: no intervu credential found for ${MCP_SERVER_KEY}. Run 'mcporter auth ${MCP_SERVER_KEY}'.`);
    } else {
        try {
            const rtc = createWebRtcTransport({ apiBase: API_BASE, bearer, onInput });
            const { url: watchUrl, connected } = await rtc.start();
            transports.push(rtc);
            console.log(`WATCH: ${watchUrl}`);
            connected.catch((error) => console.error(`Remote viewing never connected (${error.message}). The same-WiFi link still works.`));
        } catch (error) {
            console.error(`Remote viewing unavailable (${error.message}). The same-WiFi link still works.`);
        }
    }

    // What the phone draws is one frame plus the box to crop it to. Kept
    // here so a focus change can re-send the last frame: on a page that is
    // not changing, no new frame is coming, and the view would otherwise
    // stay stuck on the whole page after focus is discovered.
    let lastFrameData = null;

    const publish = () => {
        if (!lastFrameData) return;
        const payload = JSON.stringify({ f: lastFrameData, r: focus.r, dw: focus.dw });
        for (const t of transports) t.sendFrame(payload);
    };

    socket = new WebSocket(target.webSocketDebuggerUrl);
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
