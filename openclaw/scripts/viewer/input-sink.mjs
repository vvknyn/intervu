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
 */

/** windowsVirtualKeyCode for the two keys the wire contract allows. */
const KEY_CODES = { Enter: 13, Tab: 9 };
const MAX_INSERT_CHARS = 2000;

const isFinite = (n) => typeof n === "number" && Number.isFinite(n);

export function createInputSink({ send, deviceWidth }) {
    let nextId = 1;
    let controlOn = false;

    const command = (method, params) => send({ id: nextId++, method, params });

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
        const windowsVirtualKeyCode = KEY_CODES[msg.key];
        if (!windowsVirtualKeyCode) return;
        const base = { key: msg.key, code: msg.key, windowsVirtualKeyCode };
        command("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
        command("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    };

    return {
        /** `text` is the raw JSON string from any transport, unparsed. */
        handle(text) {
            let msg;
            try {
                msg = JSON.parse(text);
            } catch {
                return;
            }
            if (msg?.v !== 1) return;
            if (msg.type === "control") {
                if (typeof msg.on !== "boolean") return;
                controlOn = msg.on;
                return;
            }
            if (!controlOn) return;
            if (msg.type === "tap") return dispatchTap(msg);
            if (msg.type === "text") return dispatchText(msg);
            if (msg.type === "key") return dispatchKey(msg);
            // Unknown type: dropped, not thrown — a future producer bug must
            // never crash the sink for every other transport sharing it.
        },
    };
}
