import { describe, it, type TestContext } from "node:test";
import posthog from "posthog-js";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
    TurnstileErrorNotice,
    createTurnstileTokenSlot,
    normalizeTurnstileErrorCode,
    reportTurnstileError,
} from "../../src/components/ui/turnstile-widget";
import { setPostHogClient } from "../../src/lib/analytics/posthog-client";

// What PostHogProvider does right after init (posthog-client.ts).
setPostHogClient(posthog);

/**
 * Error path of the one Turnstile wrapper. Incident: Cloudflare error 110200
 * ("domain not authorized") left the widget showing "Unable to connect" on
 * every velai form while signups silently died. The wrapper now reports the
 * code and shows the visitor a way forward.
 */

describe("normalizeTurnstileErrorCode", () => {
    it("passes Cloudflare's numeric codes through", () => {
        assert.equal(normalizeTurnstileErrorCode("110200"), "110200");
        assert.equal(normalizeTurnstileErrorCode("script_load_failed"), "script_load_failed");
    });

    it("never lets free-form text ride into analytics", () => {
        for (const raw of ["", undefined, null, 110200, "a@b.com", "x".repeat(40), "two words"]) {
            assert.equal(normalizeTurnstileErrorCode(raw), "unknown", `raw=${String(raw)}`);
        }
    });
});

/** Same "PostHog is up" fixture as events.test.ts: no window and __loaded=false in Node, so stand both up and restore. */
function withReadyPostHog(t: TestContext, fn: (capture: ReturnType<TestContext["mock"]["method"]>) => void) {
    const capture = t.mock.method(posthog, "capture", () => {});
    const originalLoaded = posthog.__loaded;
    posthog.__loaded = true;
    const hadWindow = "window" in globalThis;
    if (!hadWindow) (globalThis as { window?: unknown }).window = {};
    try {
        fn(capture);
    } finally {
        posthog.__loaded = originalLoaded;
        if (!hadWindow) delete (globalThis as { window?: unknown }).window;
    }
}

describe("reportTurnstileError", () => {
    it("emits turnstile_error with code + surface only, for each surface", (t) => {
        withReadyPostHog(t, (capture) => {
            for (const surface of ["signup", "search_alert", "contact"] as const) {
                assert.equal(reportTurnstileError("110200", surface), "110200");
            }
            assert.deepEqual(
                capture.mock.calls.map((c) => c.arguments),
                ["signup", "search_alert", "contact"].map((surface) => ["turnstile_error", { code: "110200", surface }]),
            );
        });
    });

    it("records a garbage code as unknown, never the raw value", (t) => {
        withReadyPostHog(t, (capture) => {
            reportTurnstileError("ada@example.com", "signup");
            assert.deepEqual(capture.mock.calls[0].arguments, ["turnstile_error", { code: "unknown", surface: "signup" }]);
        });
    });
});

describe("TurnstileErrorNotice", () => {
    it("with a surface message (signup): shows it in the alert instead of the reload advice", () => {
        const message = "Security check couldn't load. Sign up with Google or an email code above.";
        const html = renderToStaticMarkup(React.createElement(TurnstileErrorNotice, { message }));
        assert.match(html, /role="alert"/);
        assert.match(html, /data-testid="turnstile-error"/);
        assert.match(html, /Sign up with Google or an email code above/);
        assert.doesNotMatch(html, /Reload the page/);
        assert.doesNotMatch(html, /<button/);
    });

    it("without one (alert capture, follow, contact, waitlist): says to reload, invents no alternative", () => {
        const html = renderToStaticMarkup(React.createElement(TurnstileErrorNotice, {}));
        assert.match(html, /Reload the page/);
        assert.doesNotMatch(html, /<button/);
    });
});

/**
 * Incident 2026-10-01: a signup retried six times on ONE token. Cloudflare
 * accepts a token once ("timeout-or-duplicate" after), the widget still said
 * Success, and every retry spent a rate-limit slot. The slot hands a token out
 * once; the form resets the widget for the next.
 */
describe("createTurnstileTokenSlot", () => {
    it("hands a token out once, never twice", async () => {
        const slot = createTurnstileTokenSlot(true, 20);
        slot.onVerify("tok-1");
        assert.deepEqual(await slot.take(), { status: "ready", token: "tok-1" });
        assert.deepEqual(await slot.take(), { status: "pending" }, "a second submit must not resend the spent token");
    });

    it("waits for a token still on its way instead of sending none", async () => {
        const slot = createTurnstileTokenSlot(true, 1_000);
        const taking = slot.take();
        setTimeout(() => slot.onVerify("tok-2"), 5);
        assert.deepEqual(await taking, { status: "ready", token: "tok-2" });
    });

    it("says pending when no token arrives in time, failed when the challenge cannot run", async () => {
        assert.deepEqual(await createTurnstileTokenSlot(true, 5).take(), { status: "pending" });
        const broken = createTurnstileTokenSlot(true, 1_000);
        const taking = broken.take();
        broken.onError();
        assert.deepEqual(await taking, { status: "failed" });
    });

    it("an expired token (onVerify(null)) or a reset (clear) leaves nothing to send", async () => {
        const slot = createTurnstileTokenSlot(true, 5);
        slot.onVerify("tok-3");
        slot.onVerify(null);
        assert.deepEqual(await slot.take(), { status: "pending" });
        slot.onVerify("tok-4");
        slot.clear();
        assert.deepEqual(await slot.take(), { status: "pending" });
    });

    it("with no site key in the build, is ready at once with no token (the server's not-configured pass)", async () => {
        assert.deepEqual(await createTurnstileTokenSlot(false, 1_000).take(), { status: "ready", token: null });
    });
});

