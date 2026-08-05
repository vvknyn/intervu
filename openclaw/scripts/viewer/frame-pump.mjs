/**
 * Speaks the CDP screencast protocol. Deliberately socket-free and
 * transport-free: it is handed a `send` and fed raw messages, so the entire
 * protocol is unit-testable without a browser and without mocks.
 *
 * Two properties of Page.startScreencast carry the performance story, and
 * both are the reason this needs no throttling logic of its own:
 *   - Chrome emits a frame only when pixels actually change, so an idle form
 *     costs nothing.
 *   - Chrome will not send the next frame until the last one is acked, so
 *     acking on delivery makes a slow phone link self-throttle instead of
 *     building a backlog.
 */

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 60;

/**
 * Reports the focused field's box, plus the viewport width the box is
 * measured against. BODY and HTML are excluded deliberately: when nothing is
 * focused `document.activeElement` is BODY, whose rect is the whole page —
 * which would silently produce a full-page "crop" that looks like the
 * feature is broken rather than idle.
 */
const FOCUS_EXPRESSION = `JSON.stringify((() => {
  const el = document.activeElement;
  const usable = el && el.getBoundingClientRect && !["BODY", "HTML"].includes(el.tagName);
  const r = usable ? el.getBoundingClientRect() : null;
  return { dw: window.innerWidth, r: r && r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null };
})())`;

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} FocusRect
 * @typedef {{ dw: number, r: FocusRect | null }} FocusReport
 *
 * @typedef {{ id: number, method: string, params: Record<string, unknown> }} CdpCommand
 *
 * @param {object} deps
 * @param {(message: CdpCommand) => void} deps.send        Writes one CDP command.
 * @param {(frame: { data: string, metadata: object }) => void} deps.onFrame
 * @param {(focus: FocusReport | null) => void} [deps.onFocus]  null when the page could not be asked.
 */
export function createFramePump({ send, onFrame, onFocus = () => {} }) {
    let nextId = 1;
    let initialShotId = null;
    const focusIds = new Set();

    const command = (method, params) => {
        const id = nextId++;
        send({ id, method, params });
        return id;
    };

    return {
        start() {
            command("Page.enable", {});
            // The same property that makes this cheap makes it start blank:
            // a page that has finished rendering changes no pixels and so
            // emits no frames at all (measured: 0 frames in 5s on a static
            // page). Capture the current screen once so a viewer always
            // opens onto something rather than waiting for the agent to move.
            initialShotId = command("Page.captureScreenshot", {
                format: "jpeg",
                quality: JPEG_QUALITY,
            });
            command("Page.startScreencast", {
                format: "jpeg",
                quality: JPEG_QUALITY,
                maxWidth: MAX_DIMENSION,
                maxHeight: MAX_DIMENSION,
                everyNthFrame: 1,
            });
        },

        /** Timer lives in the caller; the decision of what to ask lives here. */
        pollFocus() {
            focusIds.add(command("Runtime.evaluate", { expression: FOCUS_EXPRESSION, returnByValue: true }));
        },

        handle(message) {
            if (message?.id !== undefined && focusIds.has(message.id)) {
                focusIds.delete(message.id);
                try {
                    onFocus(JSON.parse(message.result.result.value));
                } catch {
                    onFocus(null);
                }
                return;
            }
            if (message?.method === "Page.screencastFrame") {
                const { data, sessionId, metadata } = message.params;
                onFrame({ data, metadata });
                command("Page.screencastFrameAck", { sessionId });
                return;
            }
            if (initialShotId !== null && message?.id === initialShotId) {
                initialShotId = null;
                if (message.result?.data) onFrame({ data: message.result.data, metadata: {} });
            }
        },
    };
}
