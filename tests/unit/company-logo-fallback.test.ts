import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { isPlaceholderFavicon, shouldShowFavicon, MIN_REAL_FAVICON_PX } from "@/lib/companies/logo";

/**
 * Defect [2] (launch-consistency sweep, 2026-09): some `/jobs` rows rendered
 * a blank white square instead of the colored-initial fallback. The stated
 * hypothesis ("URL present but fails to load, no onError path") did NOT
 * hold — `CompanyLogo.tsx` already had an `onError` handler. The real gap:
 * Google's favicons endpoint can respond HTTP 200 with a validly-decodable
 * ~16px generic placeholder glyph when it has no real favicon, so `onError`
 * never fires and the component believed the load succeeded.
 *
 * `shouldShowFavicon` covers every way the favicon attempt can be skipped
 * (absent domain, empty-string domain, or `errored` already set — whether
 * set by a real load failure or by the new placeholder detection below).
 * `isPlaceholderFavicon` is the new signal that classifies a "successful"
 * load as the generic glyph instead of a real logo.
 */

describe("shouldShowFavicon — every way a logo can fail to render", () => {
    it("does not show the favicon when the domain is absent (null)", () => {
        assert.equal(shouldShowFavicon(null, false), false);
    });

    it("does not show the favicon when the domain is an empty string", () => {
        assert.equal(shouldShowFavicon("", false), false);
    });

    it("does not show the favicon once a load has failed (errored=true)", () => {
        assert.equal(shouldShowFavicon("acme.com", true), false);
    });

    it("does show the favicon for a present domain that has not errored — a good logo load", () => {
        assert.equal(shouldShowFavicon("acme.com", false), true);
    });
});

describe("isPlaceholderFavicon — Google's generic glyph vs. a real logo", () => {
    it("flags the ~16px generic fallback glyph as a placeholder", () => {
        assert.equal(isPlaceholderFavicon(16), true);
    });

    it("does not flag a real, natively-sized favicon as a placeholder", () => {
        assert.equal(isPlaceholderFavicon(128), false);
    });

    it("does not flag a favicon exactly at the real-icon floor", () => {
        assert.equal(isPlaceholderFavicon(MIN_REAL_FAVICON_PX), false);
    });

    it("flags a favicon just below the real-icon floor", () => {
        assert.equal(isPlaceholderFavicon(MIN_REAL_FAVICON_PX - 1), true);
    });

    it("does not flag a zero width — that's an undecoded/broken image, onError's job, not this signal's", () => {
        assert.equal(isPlaceholderFavicon(0), false);
    });
});

describe("CompanyLogo.tsx wiring", () => {
    it("consumes both pure signals instead of re-inlining its own gating logic", () => {
        const src = readFileSync("src/components/jobs/CompanyLogo.tsx", "utf8");
        assert.match(src, /shouldShowFavicon\(/, "showImage should be computed via the shared shouldShowFavicon helper");
        assert.match(src, /onLoad=/, "the <img> needs an onLoad handler to catch a successful-but-placeholder load");
        assert.match(src, /isPlaceholderFavicon\(/, "onLoad should classify the load via isPlaceholderFavicon");
    });
});
