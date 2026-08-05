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

export function createFramePump({ send, onFrame }) {
    let nextId = 1;
    let initialShotId = null;

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

        handle(message) {
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
