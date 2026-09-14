import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { shouldShowFavicon } from "@/lib/companies/logo";

/**
 * Defect [2] (launch-consistency sweep, 2026-09) originally added a
 * `naturalWidth < 32px` heuristic to catch Google's placeholder glyph. That
 * heuristic was itself wrong: verified by curl, a missing favicon is an HTTP
 * 404 carrying one fixed 16px glyph, but plenty of REAL favicons (cisco.com,
 * 2,077 live roles) are also genuinely 16px and answer HTTP 200. Chromium
 * decodes both, so `onLoad`/`naturalWidth` see the same thing either way —
 * the heuristic hid real company logos behind a letter tile. The only
 * honest signal is the HTTP status, which `<img>` can't see; that needs a
 * status-aware proxy, not a client-side size guess, so it's out of scope
 * here. `shouldShowFavicon` (the one heuristic-free signal) stays as-is.
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

describe("CompanyLogo.tsx does not gate a loaded image on its intrinsic size", () => {
    it("never turns a successful decode (onLoad) into an error state via naturalWidth/naturalHeight", () => {
        const src = readFileSync("src/components/jobs/CompanyLogo.tsx", "utf8");
        // A no-favicon response (HTTP 404 + Google's fixed 16px glyph) and a
        // real favicon (e.g. cisco.com, also 16px, HTTP 200) decode to the
        // same naturalWidth — an onLoad handler that reads naturalWidth or
        // naturalHeight and calls setErrored cannot distinguish them and
        // will hide real logos. Only onError (an actual failed decode) may
        // set the error state.
        assert.doesNotMatch(
            src,
            /onLoad[\s\S]{0,400}?(naturalWidth|naturalHeight)[\s\S]{0,200}?setErrored/,
            "CompanyLogo must not suppress a successfully loaded favicon based on its intrinsic width/height — real favicons can be as small as 16px",
        );
    });
});
