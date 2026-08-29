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
import { pathToFileURL } from "node:url";
import { listPageTargets, pickActiveTarget, DEFAULT_CDP_BASE } from "./viewer/cdp-targets.mjs";
import { createFramePump } from "./viewer/frame-pump.mjs";
import { createLanTransport } from "./viewer/transport-lan.mjs";
import { createWebRtcTransport } from "./viewer/transport-webrtc.mjs";
import { createInputSink } from "./viewer/input-sink.mjs";
import { createIdAllocator } from "./viewer/cdp-id.mjs";
import { tailnetReady } from "./viewer/tailnet.mjs";
import { readAccessToken } from "./viewer/mcporter-token.mjs";
import { auditThenWatch, pickBestWatchUrl } from "./viewer/audit.mjs";

const CDP_BASE = process.env.OPENCLAW_CDP_URL || DEFAULT_CDP_BASE;
// Must stay the origin the MCP server identifies as (`AGENT.issuer()`): this
// base is used both to reach the API and to build the /watch link handed to a
// phone, and the access token it sends was minted by that same origin.
const API_BASE = process.env.INTERVU_API_BASE || "https://velai.app";
const MCP_SERVER_KEY = "intervu-cc-mcp";

/** A few seconds is generous for a same-process WebSocket round-trip and
 *  short enough that a genuinely dead page fails during PRE-FLIGHT AUDIT
 *  rather than hanging the whole viewer start. */
const CDP_EVAL_TIMEOUT_MS = 5000;

/**
 * One CDP Runtime.evaluate round-trip. Thin I/O only — the decision of
 * what to evaluate and what to do with the result lives in viewer/audit.mjs,
 * which is what's under test.
 *
 * `nextId` is the SAME allocator shared with the input sink and frame pump
 * (see cdp-id.mjs) — all three write commands onto this one socket, so one
 * shared counter is what makes their ids collision-proof.
 *
 * Rejects on a CDP protocol-level error (`message.error`, e.g. an unknown
 * method) as well as a page-side exception (`exceptionDetails`) — previously
 * only the latter was checked, so a protocol error had no `.result` at all
 * and `message.result?.result?.value` silently resolved to `undefined`,
 * printing "AUDIT: undefined" instead of a real failure. Also times out
 * rather than waiting forever for a response that will never arrive.
 */
export function cdpEvaluate(socket, expression, nextId, timeoutMs = CDP_EVAL_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const id = nextId();
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            socket.removeEventListener("message", onMessage);
            clearTimeout(timer);
            fn(value);
        };
        const timer = setTimeout(() => {
            finish(reject, new Error(`Runtime.evaluate timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const onMessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.id !== id) return;
            if (message.error) {
                finish(reject, new Error(message.error.message || "Runtime.evaluate protocol error"));
            } else if (message.result?.exceptionDetails) {
                finish(reject, new Error(message.result.exceptionDetails.text || "Runtime.evaluate threw in the page"));
            } else {
                finish(resolve, message.result?.result?.value);
            }
        };
        socket.addEventListener("message", onMessage);
        socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
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

    // ONE id allocator for every CDP command this run issues, shared by the
    // input sink, the frame pump, and cdpEvaluate below — all three write
    // onto this same socket, so one counter is what keeps their ids from
    // ever colliding (see cdp-id.mjs).
    const nextId = createIdAllocator();

    // Declared before the transports so the input sink — which every
    // transport feeds via onInput — can close over the CDP socket and the
    // live device width without waiting for the pump setup further down.
    let focus = { dw: null, dh: null, r: null };
    const sink = createInputSink({
        send: (message) => socket.send(JSON.stringify(message)),
        deviceWidth: () => focus.dw,
        deviceHeight: () => focus.dh,
        nextId,
    });
    const onInput = (text, source) => sink.handle(text, source);
    // Re-arms the control gate on any transport's client disconnect (a
    // phone reload, a dropped SSE stream, a closed data channel) — see
    // input-sink.mjs's reset() doc for why this can't be left to an
    // explicit control:false message alone.
    const onDisconnect = () => sink.reset();

    // Transports + WATCH lines. Wrapped in a function so --audit can defer
    // starting them until after the audit has already printed — a
    // transport failure must never retroactively suppress the audit.
    const startWatch = async () => {
        const transports = [];
        const lan = createLanTransport({ token: randomBytes(24).toString("base64url"), onInput, onDisconnect });
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
            console.error(`Remote viewing unavailable: no velai credential found for ${MCP_SERVER_KEY}. Run 'mcporter auth ${MCP_SERVER_KEY}'.`);
        } else {
            try {
                const rtc = createWebRtcTransport({ apiBase: API_BASE, bearer, onInput, onDisconnect });
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
        ? await auditThenWatch((expression) => cdpEvaluate(socket, expression, nextId), startWatch)
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
        nextId,
        onFrame: (frame) => { lastFrameData = frame.data; publish(); },
        onFocus: (next) => {
            const incoming = next ?? { dw: focus.dw, dh: focus.dh, r: null };
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

// CLI entry: `node scripts/viewer.mjs [--audit]`. Guarded so importing this
// module — cdpEvaluate is exported for direct unit testing — never runs
// main() as a side effect, which would otherwise try to connect to a real
// Chrome debug port and process.exit(1) the whole test process.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
