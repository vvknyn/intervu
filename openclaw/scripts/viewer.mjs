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
 * With `--audit`, runs the form audit (form-audit.js, via CDP
 * Runtime.evaluate) before any of the above and prints it as one
 * `AUDIT: <json>` line, then a `SEND-TO-USER: ...` line quoting whichever
 * watch link wins the ladder — so getting the pre-flight audit and getting
 * a forwardable link are the SAME step, not two prose instructions an
 * agent can do one of and skip the other. See openclaw/SKILL.md §3.
 *
 * Lifecycle belongs to the skill: started when form-filling begins, stopped
 * at handoff. Nothing listens while no application is in flight.
 *
 * Usage:  node scripts/viewer.mjs [--audit]
 */

import { randomBytes } from "node:crypto";
import { listPageTargets, pickActiveTarget, DEFAULT_CDP_BASE } from "./viewer/cdp-targets.mjs";
import { createFramePump } from "./viewer/frame-pump.mjs";
import { createLanTransport } from "./viewer/transport-lan.mjs";
import { createWebRtcTransport } from "./viewer/transport-webrtc.mjs";
import { createInputSink } from "./viewer/input-sink.mjs";
import { tailnetReady } from "./viewer/tailnet.mjs";
import { readAccessToken } from "./viewer/mcporter-token.mjs";
import { auditThenWatch, pickBestWatchUrl } from "./viewer/audit.mjs";

const CDP_BASE = process.env.OPENCLAW_CDP_URL || DEFAULT_CDP_BASE;
const API_BASE = process.env.INTERVU_API_BASE || "https://intervu.cc";
const MCP_SERVER_KEY = "intervu-cc-mcp";

// The audit's Runtime.evaluate is the only in-flight command on the socket
// before the frame pump (whose own ids start at 1) ever starts — see the
// `await` before `pump.start()` below — so a fixed id can never collide.
const AUDIT_EVAL_ID = 0;

/** One CDP Runtime.evaluate round-trip. Thin I/O only — the decision of
 * what to evaluate and what to do with the result lives in viewer/audit.mjs,
 * which is what's under test. */
function cdpEvaluate(socket, expression) {
    return new Promise((resolve, reject) => {
        const onMessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.id !== AUDIT_EVAL_ID) return;
            socket.removeEventListener("message", onMessage);
            if (message.result?.exceptionDetails) {
                reject(new Error(message.result.exceptionDetails.text || "Runtime.evaluate threw in the page"));
            } else {
                resolve(message.result?.result?.value);
            }
        };
        socket.addEventListener("message", onMessage);
        socket.send(JSON.stringify({ id: AUDIT_EVAL_ID, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
}

async function main() {
    const auditMode = process.argv.includes("--audit");
    const target = pickActiveTarget(await listPageTargets(CDP_BASE));
    if (!target) {
        console.error(`No open Chrome tab at ${CDP_BASE}. Open the application form first, then start the viewer.`);
        process.exit(1);
    }

    // Opened up front (not lazily, as before) so --audit can run its
    // Runtime.evaluate before anything else touches the page. Every other
    // consumer (input sink, frame pump) reuses this same socket. The error
    // listener is attached immediately, not after setup further down, so a
    // connection failure can't be missed while nothing was yet listening.
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener("error", () => {
        console.error(`Lost the connection to Chrome (tab ${target.id}).`);
        process.exit(1);
    });
    await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

    // Declared before the transports so the input sink — which every
    // transport feeds via onInput — can close over the CDP socket and the
    // live device width without waiting for the pump setup further down.
    let focus = { dw: null, r: null };
    const sink = createInputSink({
        send: (message) => socket.send(JSON.stringify(message)),
        deviceWidth: () => focus.dw,
    });
    const onInput = (text) => sink.handle(text);

    // Transports + WATCH lines. Wrapped in a function so --audit can defer
    // starting them until after the audit has already printed — a
    // transport failure must never retroactively suppress the audit.
    const startWatch = async () => {
        const transports = [];
        const lan = createLanTransport({ token: randomBytes(24).toString("base64url"), onInput });
        const { urls } = await lan.start();
        transports.push(lan);
        const lanUrl = urls.find((u) => u.kind === "lan");
        const tailnetUrl = urls.find((u) => u.kind === "tailnet");
        if (lanUrl) console.log(`WATCH-LAN: ${lanUrl.url}`);
        else console.error("No local network address found — this machine appears to be offline.");
        // Only claimed once setup is verified — an unverified tailnet
        // address is not evidence the PHONE is on the tailnet too.
        const tailnetIsReady = Boolean(tailnetUrl) && tailnetReady();
        if (tailnetUrl) {
            if (tailnetIsReady) console.log(`WATCH-ANYWHERE: ${tailnetUrl.url}`);
            else console.log("SETUP-OFFER: tailnet");
        }

        // Remote viewing is best-effort by design: it depends on a credential
        // that can expire and on a peer connection the network may refuse. When
        // it is unavailable the same-WiFi link above still works, so this must
        // never take the apply loop down — but it says exactly why, because a
        // feature that vanishes without explanation is worse than one that fails.
        const bearer = readAccessToken(MCP_SERVER_KEY);
        let watchUrl = null;
        if (!bearer) {
            console.error(`Remote viewing unavailable: no intervu credential found for ${MCP_SERVER_KEY}. Run 'mcporter auth ${MCP_SERVER_KEY}'.`);
        } else {
            try {
                const rtc = createWebRtcTransport({ apiBase: API_BASE, bearer, onInput });
                const { url, connected } = await rtc.start();
                watchUrl = url;
                transports.push(rtc);
                console.log(`WATCH: ${url}`);
                connected.catch((error) => console.error(`Remote viewing never connected (${error.message}). The same-WiFi link still works.`));
            } catch (error) {
                console.error(`Remote viewing unavailable (${error.message}). The same-WiFi link still works.`);
            }
        }
        return { transports, lanUrl: lanUrl?.url ?? null, tailnetUrl: tailnetUrl?.url ?? null, tailnetIsReady, watchUrl };
    };

    const watchResult = auditMode
        ? await auditThenWatch((expression) => cdpEvaluate(socket, expression), startWatch)
        : await startWatch();
    if (auditMode) {
        const best = pickBestWatchUrl(watchResult);
        if (best) console.log(`SEND-TO-USER: Filling this form now — watch live: ${best}`);
    }
    const { transports } = watchResult;

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

    // Socket is already open (awaited above), so start immediately instead
    // of waiting on another "open" event.
    const FOCUS_POLL_MS = 400;
    socket.addEventListener("message", (event) => pump.handle(JSON.parse(event.data)));
    pump.start();
    const focusTimer = setInterval(() => pump.pollFocus(), FOCUS_POLL_MS);

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
