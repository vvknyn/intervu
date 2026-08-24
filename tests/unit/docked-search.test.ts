import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Two defects in the header's docked search, both reported 2026-08-24.
 *
 * 1. Clicking it scrolled the search box UNDER the sticky header, taking the
 *    suggestion list — which hangs off the input — over the header with it.
 *    Cause: three places each decided for themselves how tall the header is.
 *    The IntersectionObserver knew it was 64px; the scroll that followed did
 *    not. Fix: one `--topbar-h` token that the bar SIZES ITSELF from, so a
 *    number restated anywhere else is drift by definition.
 *
 * 2. It didn't read as a search bar. Fix: it takes the bar's free width
 *    instead of sitting in a 380px cap with a gap beside it.
 *
 * These guard the shape of both fixes at every site that clears the header,
 * not just the one that surfaced each bug.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const CSS = read("src/app/globals.css");
const TOPBAR = read("src/components/layout/TopBar.tsx");
const JOBS = read("src/app/jobs/page.tsx");

/** Source with JSX comments removed, so a number quoted in prose isn't read as code. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every `className="..."` value in a file. */
const classNamesIn = (src: string) => [...src.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);

/** The className of the element carrying `data-testid="<id>"`. */
function classNameForTestId(src: string, id: string): string {
    const at = src.indexOf(`data-testid="${id}"`);
    assert.notEqual(at, -1, `no element carries data-testid="${id}"`);
    const after = src.slice(at);
    const before = src.slice(0, at);
    const m = after.match(/className="([^"]*)"/) ?? before.match(/className="([^"]*)"$/);
    assert.ok(m, `data-testid="${id}" has no className`);
    return m[1];
}

/** A bare pixel length — the thing that must not appear where the token belongs. */
const BARE_PX = /\b\d{2,4}\s*px\b|\b-?\d{2,4}\b(?!\s*px)/;

describe("header height: one token, every clearance derived from it", () => {
    it("the token exists and the bar sizes itself from it", () => {
        assert.match(CSS, /--topbar-h:\s*\d+px;/, "globals.css must define the header height once");
        const row = classNamesIn(TOPBAR).find((c) => c.includes("shell-row"));
        assert.ok(row, "TopBar has no shell row");
        assert.match(row, /\bh-\[var\(--topbar-h\)\]/, "the bar must take its height FROM the token");
        assert.doesNotMatch(row, /\bh-\d/, "a literal height lets the bar drift from every offset derived from it");
    });

    it("the scroll target states its clearance in the token", () => {
        // The site that surfaced the bug: scrollIntoView aligns with the scroll
        // port, which is behind the header.
        const scrollMt = stripComments(JOBS).match(/\bscroll-mt-\[([^\]]*)\]/);
        assert.ok(scrollMt, "the search shell must carry a scroll-mt so scrollIntoView clears the header");
        assert.match(scrollMt[1], /var\(--topbar-h\)/, "the clearance must read the token, not restate a number");
    });

    it("the observer's margin is derived too, not a second opinion on the height", () => {
        // The case OTHER than the one that surfaced the bug. These two sites
        // disagreeing IS the defect; a literal here would restore it.
        const rootMargin = stripComments(JOBS).match(/rootMargin:\s*(`[^`]*`|"[^"]*")/);
        assert.ok(rootMargin, "the dock observer must state a rootMargin");
        assert.doesNotMatch(
            rootMargin[1].replace(/0px/g, ""),
            BARE_PX,
            "rootMargin hardcodes the header height instead of measuring it",
        );
        assert.match(rootMargin[1], /\$\{/, "it must interpolate a measured value");
    });

    it("the bare-pixel guard can actually detect a bare pixel", () => {
        // Without this, the assertion above would pass on any string at all.
        assert.match('"-64px 0px 0px 0px"'.replace(/0px/g, ""), BARE_PX);
        assert.match("`-${64}px`".replace(/0px/g, ""), BARE_PX);
        assert.doesNotMatch("`-${headerHeightPx()}px 0px 0px 0px`".replace(/0px/g, ""), BARE_PX);
    });
});

describe("docked search: fills the bar's free width", () => {
    it("grows into the space rather than sitting in a fixed cap", () => {
        const pill = classNameForTestId(TOPBAR, "topbar-docked-search");
        assert.match(pill, /\bflex-1\b/, "the docked search must absorb the bar's leftover width");
        assert.doesNotMatch(pill, /\bmax-w-/, "a width cap is what left the empty gap beside it");
        assert.match(pill, /\bmin-w-0\b/, "without min-w-0 a flex child refuses to shrink and overflows the bar");
    });

    it("its row hands it that width instead of pooling it as a gap", () => {
        // The other half of the same fix: `flex-1` on the button is inert if
        // the row it sits in is only as wide as its contents.
        const cluster = classNamesIn(TOPBAR).find(
            (c) => /\bflex-1\b/.test(c) && /\bjustify-end\b/.test(c) && !c.includes("shell-row"),
        );
        assert.ok(cluster, "the bar's right-hand row must claim the free width for the docked search to fill");
        assert.match(cluster, /\bmin-w-0\b/, "the row must be allowed to shrink below its content width");
    });

    it("wears the search field's chrome, not a label's", () => {
        const pill = classNameForTestId(TOPBAR, "topbar-docked-search");
        assert.match(pill, /\bbg-card\b/, "a search box sits on the card ground the real field uses");
        assert.match(pill, /\bborder\b/, "a search box has a visible edge");
    });
});
