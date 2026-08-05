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
    const command = (method, params) => send({ id: nextId++, method, params });

    return {
        start() {
            command("Page.enable", {});
            command("Page.startScreencast", {
                format: "jpeg",
                quality: JPEG_QUALITY,
                maxWidth: MAX_DIMENSION,
                maxHeight: MAX_DIMENSION,
                everyNthFrame: 1,
            });
        },

        handle(message) {
            if (message?.method !== "Page.screencastFrame") return;
            const { data, sessionId, metadata } = message.params;
            onFrame({ data, metadata });
            command("Page.screencastFrameAck", { sessionId });
        },
    };
}
