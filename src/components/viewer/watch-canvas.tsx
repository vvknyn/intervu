"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeCrop } from "../../../openclaw/scripts/viewer/crop.mjs";

/**
 * Answers the laptop's offer, then paints whatever arrives on the data
 * channel.
 *
 * Follows the field the agent is filling (spec D3a). Mirroring the whole
 * 1512px viewport renders at ~26% on a phone, which no quality setting
 * rescues — the image has to be cropped, not scaled. `computeCrop` is
 * imported from the skill rather than reimplemented so this page and the
 * same-WiFi page cannot drift apart.
 */

type Payload = { f: string; r: { x: number; y: number; width: number; height: number } | null; dw: number | null };
type Latest = { img: HTMLImageElement; rect: Payload["r"]; deviceWidth: number };

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
    const [status, setStatus] = useState("connecting…");
    const [live, setLive] = useState(false);
    const [follow, setFollow] = useState(true);

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
            setLive(true);
            setStatus(crop ? "live — following the field" : "live");
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

        (async () => {
            for (let attempt = 0; attempt < HOST_WAIT_ATTEMPTS && !cancelled; attempt++) {
                const res = await fetch(url);
                if (res.status === 401) return setStatus("log in to intervu on this phone, then reopen this link");
                if (!res.ok) return setStatus("this session has ended");

                const { host } = (await res.json()) as { host: { sdp: string } | null };
                if (!host) {
                    setStatus("waiting for your laptop…");
                    await sleep(1000);
                    continue;
                }

                pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
                pc.ondatachannel = (event) => {
                    event.channel.onmessage = (message) => draw(message.data as string);
                };
                await pc.setRemoteDescription({ type: "offer", sdp: host.sdp });
                await pc.setLocalDescription(await pc.createAnswer());
                await iceGathered(pc);
                if (cancelled) return;

                await fetch(url, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ role: "guest", sdp: pc.localDescription?.sdp }),
                });
                setStatus("connecting to your laptop…");
                return;
            }
            if (!cancelled) setStatus("your laptop never answered — it may have finished");
        })().catch((error: Error) => setStatus(`could not connect: ${error.message}`));

        return () => {
            cancelled = true;
            pc?.close();
        };
        // `render` is deliberately excluded: it changes with `follow`, and
        // re-running this would tear down a working peer connection just
        // because the user tapped to zoom out. The toggle is handled above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    return (
        <main className="min-h-dvh bg-black text-white" onClick={() => setFollow((f) => !f)}>
            <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-black px-4 py-3 text-sm">
                <span className={`h-2 w-2 flex-none rounded-full ${live ? "bg-emerald-400" : "bg-white/30"}`} />
                <span data-testid="watch-status">{status}</span>
                <span className="ml-auto text-xs text-white/50">
                    {follow ? "tap to zoom out" : "tap to follow field"}
                </span>
            </header>
            <canvas ref={canvasRef} className="block h-auto w-full" />
        </main>
    );
}
