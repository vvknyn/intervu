import { describe, it, type TestContext } from "node:test";
import posthog from "posthog-js";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
    TurnstileErrorNotice,
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
