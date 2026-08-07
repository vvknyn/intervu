/**
 * The one place any transport's input message becomes a CDP command.
 *
 * Every wire message — LAN's POST /input, WebRTC's data channel — funnels
 * here so there is exactly one validator for the wire contract and exactly
 * one caller of Input.*. Control is a gate on the whole class of input
 * messages, not a per-type permission: nothing reaches CDP until the phone
 * has explicitly taken control, and turning it off re-arms the gate rather
 * than remembering "was on once". A message that fails validation is
 * dropped, never thrown — a malformed or out-of-contract line from a
 * transport must not take the viewer down.
 *
 * `reset()` re-arms the gate the same way an explicit control:false message
 * does, but from the OUTSIDE: every transport calls it when its client
 * disconnects (a phone reload, a dropped SSE stream, a closed data
 * channel), so control granted before a reconnect can never carry over to
 * whatever page comes back — a raw POST /input from a stale LAN token would
 * otherwise still find the gate open.
 *
 * Every control transition is logged to stdout — the agent transcript must
 * record every control grant, not just the fact that SOME input flowed.
 */
import { createIdAllocator } from "./cdp-id.mjs";

/** windowsVirtualKeyCode — and, where native behavior depends on it, the
 *  `text` to send with the down event — for the two keys the wire contract
 *  allows. Enter needs `text:"\r"` on a `keyDown`: a textless `rawKeyDown`
 *  never fires the native form/textarea submit-or-newline handling a real
 *  Enter keypress does. Tab has no analogous text and stays `rawKeyDown`. A
 *  lookup table, not an if/else ladder, so a third allowed key is one more
 *  row, not another branch to remember. */
const KEYS = {
    Enter: { windowsVirtualKeyCode: 13, type: "keyDown", text: "\r" },
    Tab: { windowsVirtualKeyCode: 9, type: "rawKeyDown" },
};
const MAX_INSERT_CHARS = 2000;

const isFinite = (n) => typeof n === "number" && Number.isFinite(n);

export function createInputSink({ send, deviceWidth, nextId = createIdAllocator(), log = console.log }) {
    let controlOn = false;

    const command = (method, params) => {
        const id = nextId();
        send({ id, method, params });
        return id;
    };

    const setControl = (on, source) => {
        controlOn = on;
        log(`CONTROL ${on ? "ON" : "OFF"} (${source})`);
    };

    const dispatchTap = (msg) => {
        if (!isFinite(msg.fx) || !isFinite(msg.fy) || !isFinite(msg.fw) || !isFinite(msg.fh)) return;
        const dw = deviceWidth();
        // No live device width means no scale exists yet — guessing would
        // click the wrong place, so drop rather than fabricate one.
        if (!isFinite(dw)) return;
        const x = Math.round((msg.fx * dw) / msg.fw);
        const y = Math.round((msg.fy * dw) / msg.fw);
        const base = { x, y, button: "left", clickCount: 1 };
        command("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
        command("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
    };

    const dispatchText = (msg) => {
        if (typeof msg.insert !== "string" || msg.insert.length > MAX_INSERT_CHARS) return;
        command("Input.insertText", { text: msg.insert });
    };

    const dispatchKey = (msg) => {
        const key = KEYS[msg.key];
        if (!key) return;
        const base = { key: msg.key, code: msg.key, windowsVirtualKeyCode: key.windowsVirtualKeyCode };
        const down = key.text !== undefined ? { ...base, text: key.text } : base;
        command("Input.dispatchKeyEvent", { type: key.type, ...down });
        command("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    };

    return {
        /** `text` is the raw JSON string from any transport, unparsed.
         *  `source` labels which transport delivered it (e.g. "lan",
         *  "webrtc") purely for the CONTROL ON/OFF log line — it never
         *  affects the gate itself. */
        handle(text, source = "unknown") {
            let msg;
            try {
                msg = JSON.parse(text);
            } catch {
                return;
            }
            if (msg?.v !== 1) return;
            if (msg.type === "control") {
                if (typeof msg.on !== "boolean") return;
                setControl(msg.on, source);
                return;
            }
            if (!controlOn) return;
            if (msg.type === "tap") return dispatchTap(msg);
            if (msg.type === "text") return dispatchText(msg);
            if (msg.type === "key") return dispatchKey(msg);
            // Unknown type: dropped, not thrown — a future producer bug must
            // never crash the sink for every other transport sharing it.
        },

        /** Unconditionally re-arms the gate; logs only when it actually
         *  changed something, so an ordinary disconnect that was never
         *  controlling anything doesn't spam the transcript. */
        reset() {
            if (controlOn) {
                controlOn = false;
                log("CONTROL RESET (disconnect)");
            }
        },
    };
}
