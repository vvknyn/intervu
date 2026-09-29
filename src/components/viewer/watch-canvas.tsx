"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeCrop } from "../../../openclaw/scripts/viewer/crop.mjs";
import {
    classifyTyperInput,
    controlMessage,
    frameScrollMessage,
    frameTapMessage,
    isSwipe,
    keyMessage,
    SCROLL_THROTTLE_MS,
    TYPER_SENTINEL,
} from "../../../openclaw/scripts/viewer/input-capture.mjs";
import { fingerprintSdp } from "../../../openclaw/scripts/viewer/sdp-fingerprint.mjs";
import { ENDED_COPY, isNewOffer, tapAction, trySend, type TapMessage } from "@/lib/viewer/watch-input";

/**
 * Answers the laptop's offer, then paints whatever arrives on the data
 * channel.
 *
 * Follows the field the agent is filling (spec D3a). Mirroring the whole
 * 1512px viewport renders at ~26% on a phone, which no quality setting
 * rescues — the image has to be cropped, not scaled. `computeCrop` is
 * imported from the skill rather than reimplemented so this page and the
 * same-WiFi page cannot drift apart. `input-capture.mjs` is shared the same
 * way for tap-to-frame-point inversion (D8).
 *
 * Control (D8) is off by default: a tap on the canvas zooms, same as
 * before. Once "take control" is on, the canvas sends taps instead and zoom
 * moves to the header status chip — the tap-to-zoom label would otherwise
 * lie about what a tap does. The decisions of what a tap means and whether
 * a reconnect offer is new live in src/lib/viewer/watch-input.ts, kept pure
 * and DOM-free so they're unit-testable (this repo has no component-render
 * harness — no @testing-library/jsdom/vitest).
 */

type Payload = { f: string; r: { x: number; y: number; width: number; height: number } | null; dw: number | null };
type Latest = { img: HTMLImageElement; rect: Payload["r"]; deviceWidth: number };
type TouchState = { startX: number; startY: number; lastY: number; accDy: number; swiped: boolean; lastSentAt: number };

/**
 * Colors the status dot and text (2026-08-26 redesign, §04): live/pending/
 * ended, honestly set at each `setStatus` call site alongside its own text
 * rather than re-derived later by pattern-matching that text — a future
 * status string only has to be classified once, where it's actually known,
 * not guessed at from a rendered string. Hardcoded hex/Tailwind palette
 * colors are the one sanctioned exception to the token rule: the watch frame
 * is deliberately single-theme dark and doesn't read the site's light/dark
 * tokens (see module doc).
 */
type StatusTone = "live" | "pending" | "ended";
const STATUS_TONE_STYLE: Record<StatusTone, { dot: string; text: string }> = {
    live: { dot: "bg-live", text: "text-live" },
    pending: { dot: "bg-warn", text: "text-warn" },
    ended: { dot: "bg-white", text: "text-white" },
};

/** How long to wait for the laptop to post its offer, in 1s attempts. The
 *  phone can win the race when the link is opened the instant it arrives. */
const HOST_WAIT_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Browsers trickle by default, so the answer's SDP is empty until gathering
 *  finishes. The laptop expects one complete SDP and relays no candidates. */
function iceGathered(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
        const check = () => {
            if (pc.iceGatheringState !== "complete") return;
            pc.removeEventListener("icegatheringstatechange", check);
            resolve();
        };
        pc.addEventListener("icegatheringstatechange", check);
    });
}

export function WatchCanvas({ sessionId }: { sessionId: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const latestRef = useRef<Latest | null>(null);
    const channelRef = useRef<RTCDataChannel | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const touchRef = useRef<TouchState | null>(null);
    const [statusText, setStatusText] = useState("connecting…");
    const [statusTone, setStatusTone] = useState<StatusTone>("pending");
    // The one place status text and its color are set — see STATUS_TONE_STYLE's
    // doc for why this is a paired setter rather than two independent ones.
    const setStatus = (text: string, tone: StatusTone) => {
        setStatusText(text);
        setStatusTone(tone);
    };
    const [follow, setFollow] = useState(true);
    const [controlOn, setControlOn] = useState(false);

    const render = useCallback(
        (frame: Latest) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const { img, rect, deviceWidth } = frame;
            const crop = follow
                ? computeCrop(rect, { imageWidth: img.width, imageHeight: img.height, deviceWidth })
                : null;
            const { sx, sy, sw, sh } = crop ?? { sx: 0, sy: 0, sw: img.width, sh: img.height };
            if (canvas.width !== sw || canvas.height !== sh) {
                canvas.width = sw;
                canvas.height = sh;
            }
            canvas.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
            setStatus(crop ? "live — following the field" : "live", "live");
        },
        [follow],
    );

    // Re-draw on toggle: on a page that is not changing no new frame is
    // coming, so without this the view would stay as it was until the agent
    // happened to type.
    useEffect(() => {
        if (latestRef.current) render(latestRef.current);
    }, [render]);

    useEffect(() => {
        let pc: RTCPeerConnection | null = null;
        let cancelled = false;
        // Guards onconnectionstatechange re-entrancy: "disconnected" then
        // "closed" can both fire for one drop, which must start one
        // reconnect join(), not two racing ones.
        let reconnecting = false;
        const url = `/api/viewer/session/${sessionId}/signal`;

        const draw = (text: string) => {
            let payload: Payload;
            try {
                payload = JSON.parse(text) as Payload;
            } catch {
                return;
            }
            const img = new Image();
            img.onload = () => {
                latestRef.current = { img, rect: payload.r, deviceWidth: payload.dw || img.width };
                render(latestRef.current);
            };
            img.src = `data:image/jpeg;base64,${payload.f}`;
        };

        // Shared by mount and by D11 reconnect: `previousOfferSdp` is null on
        // first join (any offer counts as new — see isNewOffer) and is the
        // SDP this pc already answered on reconnect, so a stale offer still
        // sitting in the signal store while the laptop is mid-renegotiation
        // is skipped rather than re-answered.
        const join = async (previousOfferSdp: string | null) => {
            for (let attempt = 0; attempt < HOST_WAIT_ATTEMPTS && !cancelled; attempt++) {
                const res = await fetch(url);
                if (res.status === 401) return setStatus("sign in to velai on this phone, then reopen this link", "ended"); // signup-gate-exempt: viewer status line after a 401, not a conversion gate
                if (!res.ok) return setStatus(ENDED_COPY, "ended");

                const { host } = (await res.json()) as { host: { sdp: string } | null };
                if (!isNewOffer(host?.sdp, previousOfferSdp)) {
                    setStatus(previousOfferSdp ? "reconnecting…" : "waiting for your laptop…", "pending");
                    await sleep(1000);
                    continue;
                }
                const offerSdp = host!.sdp;

                // A live pc from a previous offer must be CLOSED, not just
                // replaced — otherwise every reconnect leaks the peer
                // connection it's superseding. `thisPc` (a local const) is
                // what every handler below reads and compares against, not
                // the shared `pc` ref: a handler on a superseded instance
                // must become a no-op the moment a newer one takes over,
                // rather than reacting to whatever `pc` happens to point at
                // by the time its event actually fires.
                pc?.close();
                const thisPc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
                pc = thisPc;
                thisPc.onconnectionstatechange = () => {
                    if (cancelled || reconnecting || pc !== thisPc) return;
                    if (thisPc.connectionState === "failed" || thisPc.connectionState === "disconnected" || thisPc.connectionState === "closed") {
                        reconnecting = true;
                        setStatus("reconnecting…", "pending");
                        join(offerSdp).finally(() => {
                            reconnecting = false;
                        });
                    }
                };
                thisPc.ondatachannel = (event) => {
                    channelRef.current = event.channel;
                    // Frames arrive chunked: a whole frame (~140 KB) exceeds
                    // the channel's negotiated max-message-size (64 KiB on
                    // Safari), so the laptop sends "C"+body pieces ending in
                    // "F"+body over this ordered channel. Mirrors
                    // chunkPayload in the skill's transport-webrtc.mjs.
                    let assembling = "";
                    event.channel.onmessage = (message) => {
                        const piece = message.data as string;
                        if (piece[0] === "C") {
                            assembling += piece.slice(1);
                            return;
                        }
                        if (piece[0] === "F") {
                            const whole = assembling + piece.slice(1);
                            assembling = "";
                            draw(whole);
                        }
                    };
                };
                await thisPc.setRemoteDescription({ type: "offer", sdp: offerSdp });
                await thisPc.setLocalDescription(await thisPc.createAnswer());
                await iceGathered(thisPc);
                if (cancelled) return;

                await fetch(url, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    // D11.1: stamps a fingerprint of the offer this pc
                    // actually answered. A reload that re-answers a STALE
                    // offer produces a byte-different answer SDP every time
                    // (fresh ICE credentials per createAnswer()), so the
                    // host cannot tell a fresh answer from a stale re-answer
                    // by comparing answer bytes alone — see
                    // transport-webrtc.mjs's isFreshAnswer.
                    body: JSON.stringify({ role: "guest", sdp: thisPc.localDescription?.sdp, answeredOffer: fingerprintSdp(offerSdp) }),
                });
                setStatus("connecting to your laptop…", "pending");
                return;
            }
            if (!cancelled) setStatus("your laptop never answered — it may have finished", "ended");
        };

        join(null).catch((error: Error) => setStatus(`could not connect: ${error.message}`, "ended"));

        return () => {
            cancelled = true;
            pc?.close();
        };
        // `render` is deliberately excluded: it changes with `follow`, and
        // re-running this would tear down a working peer connection just
        // because the user tapped to zoom out. The toggle is handled above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // The one send site every control-channel message actually goes through
    // — see trySend's doc in watch-input.ts for why a plain
    // `channelRef.current?.send(...)` isn't enough: send() on a
    // not-yet-open or superseded channel throws synchronously, and that
    // must never escape into React. A failure here means the connection is
    // already being recovered elsewhere (onconnectionstatechange), so the
    // honest thing to say is "reconnecting", not to throw.
    const sendSafe = (message: unknown) => {
        if (!trySend(channelRef.current, message)) setStatus("reconnecting…", "pending");
    };

    // Swiping vertically in control mode scrolls the laptop's page instead
    // of tapping it. Native (non-passive) listeners are required here:
    // React attaches onTouchMove as passive by default, which silently
    // no-ops preventDefault — needed once a gesture commits to being a
    // swipe, to stop the phone's own page from scrolling too. isSwipe and
    // frameScrollMessage are shared with watch-page.html (input-capture.mjs)
    // so the two pages can't drift on the threshold or the scaling rule. No
    // momentum — raw per-move deltas only, throttled, never integrated.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const onTouchStart = (event: TouchEvent) => {
            if (!controlOn || event.touches.length !== 1) {
                touchRef.current = null;
                return;
            }
            const t = event.touches[0];
            touchRef.current = { startX: t.clientX, startY: t.clientY, lastY: t.clientY, accDy: 0, swiped: false, lastSentAt: 0 };
        };

        const onTouchMove = (event: TouchEvent) => {
            const touch = touchRef.current;
            const latest = latestRef.current;
            if (!controlOn || !touch || !latest) return;
            const t = event.touches[0];
            const dy = t.clientY - touch.lastY;
            touch.lastY = t.clientY;
            if (!touch.swiped) touch.swiped = isSwipe(t.clientX - touch.startX, t.clientY - touch.startY);
            if (!touch.swiped) return; // still inside the tap threshold
            event.preventDefault();
            touch.accDy += dy;
            const now = Date.now();
            if (now - touch.lastSentAt < SCROLL_THROTTLE_MS) return;
            const rect = canvas.getBoundingClientRect();
            const crop = follow ? computeCrop(latest.rect, { imageWidth: latest.img.width, imageHeight: latest.img.height, deviceWidth: latest.deviceWidth }) : null;
            sendSafe(frameScrollMessage({ cssDy: touch.accDy, cssWidth: rect.width, crop, imageWidth: latest.img.width, imageHeight: latest.img.height }));
            touch.accDy = 0;
            touch.lastSentAt = now;
        };

        const onTouchEnd = () => {
            touchRef.current = null;
        };

        canvas.addEventListener("touchstart", onTouchStart, { passive: true });
        canvas.addEventListener("touchmove", onTouchMove, { passive: false });
        canvas.addEventListener("touchend", onTouchEnd);
        return () => {
            canvas.removeEventListener("touchstart", onTouchStart);
            canvas.removeEventListener("touchmove", onTouchMove);
            canvas.removeEventListener("touchend", onTouchEnd);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [controlOn, follow]);

    // D8: off by default. Toggling tells the laptop's input-sink to open or
    // re-arm its gate (openclaw/scripts/viewer/input-sink.mjs) — without
    // this send, "take control" would flip the label but the laptop would
    // keep dropping every message.
    const toggleControl = () => {
        setControlOn((prev) => {
            const next = !prev;
            sendSafe(controlMessage(next));
            return next;
        });
    };

    // While control is off the canvas is still the zoom toggle it always
    // was (tapAction(false, …) is always {kind:"zoom"}). While control is
    // on, a tap becomes a frame-point send; a tap outside the frame is
    // silently ignored rather than falling back to a zoom, since flipping
    // zoom in control mode would fight the header chip that now owns it.
    const onCanvasTap = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        const latest = latestRef.current;
        const rect = canvas?.getBoundingClientRect();
        // input-capture.mjs is plain JS with no type annotations, so its
        // return crosses into TS as a loose shape; the wire contract (v:1,
        // type:"tap") is fixed at the boundary here rather than widened.
        const message =
            controlOn && canvas && rect && latest
                ? (frameTapMessage({
                      cssX: event.clientX - rect.left,
                      cssY: event.clientY - rect.top,
                      cssWidth: rect.width,
                      crop: follow ? computeCrop(latest.rect, { imageWidth: latest.img.width, imageHeight: latest.img.height, deviceWidth: latest.deviceWidth }) : null,
                      imageWidth: latest.img.width,
                      imageHeight: latest.img.height,
                  }) as TapMessage | null)
                : null;
        const action = tapAction(controlOn, message);
        if (!action) return;
        if (action.kind === "zoom") {
            setFollow((f) => !f);
            return;
        }
        sendSafe(action.message);
        inputRef.current?.focus();
    };

    return (
        <div className="min-h-dvh bg-black text-white">
            <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-white bg-black px-4 py-3 text-sm">
                <span className={`h-2 w-2 flex-none rounded-none ${STATUS_TONE_STYLE[statusTone].dot}`} />
                <span data-testid="watch-status" className={STATUS_TONE_STYLE[statusTone].text}>
                    {statusText}
                </span>
                <button
                    type="button"
                    data-testid="watch-control-toggle"
                    onClick={toggleControl}
                    className="ctl-md ctl-button border border-white px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                >
                    {controlOn ? "watching only" : "take control"}
                </button>
                {/* Real button, not a span with onClick: a span is invisible
                    to keyboard focus. Unconditionally wired so a keyboard
                    user can toggle zoom in either mode — mouse/touch users
                    keep tapping the canvas itself when control is off. */}
                <button
                    type="button"
                    data-testid="watch-zoom-chip"
                    onClick={() => setFollow((f) => !f)}
                    className="ml-auto text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                >
                    {follow ? "tap to zoom out" : "tap to follow field"}
                </button>
            </header>
            <canvas ref={canvasRef} data-testid="watch-canvas" className="block h-auto w-full" onClick={onCanvasTap} />
            {/* Focused after a tap in control mode so the phone's keyboard
                opens; visually hidden rather than unmounted so it keeps
                focus and keystrokes across re-renders. */}
            <input
                ref={inputRef}
                data-testid="watch-control-input"
                className="sr-only"
                aria-hidden={!controlOn}
                // Kept non-empty at rest — see TYPER_SENTINEL's doc for why
                // an empty field silently eats iOS's backspace event.
                defaultValue={TYPER_SENTINEL}
                onChange={(event) => {
                    const { messages, reset } = classifyTyperInput((event.nativeEvent as InputEvent).inputType, event.target.value);
                    messages.forEach(sendSafe);
                    event.target.value = reset;
                }}
                onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== "Tab") return;
                    event.preventDefault();
                    sendSafe(keyMessage(event.key));
                }}
            />
        </div>
    );
}
