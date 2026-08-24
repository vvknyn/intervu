import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The header, the page and the footer are siblings under <body>, so nothing
 * structural makes their left edges agree. Before `--shell-max` they agreed
 * only because three separate files happened to spell the same
 * `max-w-6xl xl:max-w-7xl px-4 sm:px-8 xl:px-10` string — and the moment
 * /jobs went edge to edge (2026-08-24) the frame went crooked: the logo sat
 * 320px inside the search box's left edge at 1920.
 *
 * These guard the SHAPE of the fix, not the one page that surfaced it. The
 * geometry itself is verified by measuring rendered pages at several widths —
 * on /jobs, which declares the bleed, AND on a page that doesn't and must
 * still be capped.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const CSS = read("src/app/globals.css");
const TOPBAR = read("src/components/layout/TopBar.tsx");
const FOOTER = read("src/components/layout/Footer.tsx");
const JOBS = read("src/app/jobs/page.tsx");

/** The class attribute of the first element carrying `shell-row` in a file. */
function shellRowClassIn(src: string, label: string): string {
    const m = src.match(/className="([^"]*\bshell-row\b[^"]*)"/);
    assert.ok(m, `${label} has no element using shell-row — it would no longer follow the page's width`);
    return m[1];
}

describe("shell width: one owner, declared by the page", () => {
    it("declares a capped default so a page that says nothing stays capped", () => {
        // The case OTHER than the one that surfaced this: every page except
        // /jobs opts into nothing and must keep its old width.
        const decls = CSS.match(/--shell-max:\s*([^;]+);/g) ?? [];
        assert.ok(decls.length >= 2, "expected a default plus at least one override");
        assert.match(CSS, /:root\s*\{[^}]*--shell-max:\s*\d/, "the default must be a real length, not none");
    });

    it("turns the cap off only for a page that declares it, never for a named route", () => {
        const overrides = (CSS.match(/--shell-max:\s*none\s*;/g) ?? []).length;
        assert.equal(overrides, 1, "exactly one rule may lift the cap");
        assert.match(
            CSS,
            /body:has\(\[data-shell="bleed"\]\)\s*\{\s*--shell-max:\s*none;/,
            "the lift must key off an attribute the page renders, not a route path",
        );
        // A route literal anywhere near the shell variable would mean the
        // stylesheet had started enumerating pages.
        const shellBlock = CSS.slice(CSS.indexOf("--shell-max"), CSS.indexOf(".shell-row") + 400);
        assert.doesNotMatch(shellBlock, /["'`]\/[a-z]/, "shell geometry must not name a route");
    });

    it("both chrome bands read the shared row and state no width of their own", () => {
        for (const [label, src] of [["TopBar", TOPBAR], ["Footer", FOOTER]] as const) {
            const cls = shellRowClassIn(src, label);
            assert.doesNotMatch(
                cls,
                /(?:^|\s)(?:sm:|md:|lg:|xl:|2xl:)?max-w-/,
                `${label}'s shell row hardcodes a max-width, which beats --shell-max and re-crooks the frame`,
            );
            assert.doesNotMatch(
                cls,
                /(?:^|\s)(?:sm:|md:|lg:|xl:|2xl:)?px-/,
                `${label}'s shell row hardcodes a gutter; shell-row owns padding so the three rows can't drift`,
            );
        }
    });

    it("/jobs asks for the full window rather than assuming it", () => {
        assert.match(JOBS, /data-shell="bleed"/, "the page must declare the bleed for the chrome to follow");
        const cls = shellRowClassIn(JOBS, "jobs main");
        assert.doesNotMatch(cls, /(?:^|\s)(?:sm:|md:|lg:|xl:|2xl:)?max-w-/);
    });

    it("the max-width guard can actually detect a max-width", () => {
        // Without this the assertions above would pass on an empty string.
        const probe = /(?:^|\s)(?:sm:|md:|lg:|xl:|2xl:)?max-w-/;
        assert.match("flex w-full max-w-6xl xl:max-w-7xl", probe);
        assert.match("relative xl:max-w-7xl flex", probe);
        assert.doesNotMatch("shell-row relative flex h-16 items-center", probe);
    });
});
