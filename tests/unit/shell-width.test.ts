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

/**
 * Every `shell-row` declaration in a file, each reduced to a single string:
 * every string/template literal inside that ONE `className=` expression,
 * joined. Two properties this must hold, both learned from real regressions:
 *
 * 1. Only real className expressions are in scope —
 *    `className="..."` / `className={...}` — never arbitrary quoted or
 *    backtick-delimited text. TopBar and Footer each carry a JSX comment
 *    mentioning `` `shell-row` `` for the human reader
 *    (`{/* `shell-row` (globals.css) owns the width... *\/}`); a regex that
 *    hunts for any quoted string containing "shell-row" matches the COMMENT
 *    (extracting the literal one-word string "shell-row", which can never
 *    contain max-w-/px- and passes for free) as readily as the real
 *    className, silently disabling the guard on exactly the files it exists
 *    to check. Scoping to `className=` sites makes the comment unreachable.
 * 2. Every literal in the expression counts, not just the one containing
 *    "shell-row" — `cn("shell-row flex", isWide && "max-w-6xl")` puts the
 *    forbidden class in a SIBLING argument. A joined-literal extractor
 *    reaches it; one that returns only the shell-row-bearing literal doesn't.
 *
 * Multiple elements per file are collected (TopBar has two: the desktop
 * header row and the mobile row), not just the first — the corresponding
 * assertions must run against every one, else a later element is unguarded.
 */
function shellRowDeclarationsIn(src: string): string[] {
    const found: string[] = [];
    const literalRe = /["'`]((?:[^"'`\\]|\\.)*)["'`]/g;
    const attrRe = /className=/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(src))) {
        const start = m.index + m[0].length;
        let joined: string | null = null;
        if (src[start] === '"') {
            // Bare attribute: the quoted content itself IS the class list.
            const end = src.indexOf('"', start + 1);
            if (end !== -1) joined = src.slice(start + 1, end);
        } else if (src[start] === "{") {
            // A JS expression: className={cn(...)} / {clsx(...)} / {`...`}.
            // Balanced-brace scan (handles multi-line cn(...) calls) rather
            // than a parser — the codebase's className={...} expressions
            // don't nest object/JSX literals, only call/ternary syntax.
            let depth = 0;
            let i = start;
            for (; i < src.length; i++) {
                if (src[i] === "{") depth++;
                else if (src[i] === "}" && --depth === 0) break;
            }
            const exprText = src.slice(start + 1, i);
            // Every string/template literal in the expression, joined — a
            // sibling cn(...) argument counts as much as the one bearing
            // "shell-row" itself.
            joined = [...exprText.matchAll(literalRe)].map((x) => x[1]).join(" ");
        }
        if (joined !== null && /\bshell-row\b/.test(joined)) found.push(joined);
    }
    return found;
}

const MAX_W_PROBE = /(?:^|\s)(?:sm:|md:|lg:|xl:|2xl:)?max-w-/;
const PX_PROBE = /(?:^|\s)(?:sm:|md:|lg:|xl:|2xl:)?px-/;

/** Every shell-row element in a file must be found, and every one clean. */
function assertAllShellRowsClean(src: string, label: string): string[] {
    const decls = shellRowDeclarationsIn(src);
    assert.ok(decls.length > 0, `${label} has no element using shell-row — it would no longer follow the page's width`);
    for (const cls of decls) {
        assert.doesNotMatch(
            cls,
            MAX_W_PROBE,
            `${label}'s shell row "${cls}" hardcodes a max-width, which beats --shell-max and re-crooks the frame`,
        );
        assert.doesNotMatch(
            cls,
            PX_PROBE,
            `${label}'s shell row "${cls}" hardcodes a gutter; shell-row owns padding so the three rows can't drift`,
        );
    }
    return decls;
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
        // TopBar has two shell-row elements (desktop header row + mobile
        // row); Footer has one. Every one found must be checked.
        const topBarDecls = assertAllShellRowsClean(TOPBAR, "TopBar");
        assert.equal(topBarDecls.length, 2, "expected TopBar's desktop row AND its mobile row, not just the first");
        assertAllShellRowsClean(FOOTER, "Footer");
    });

    it("extracts only real className expressions, never a comment that mentions shell-row", () => {
        // The regression: TopBar/Footer each carry a JSX comment like
        // `{/* \`shell-row\` (globals.css) owns the width... */}` right above
        // the real className. A regex hunting any quoted text for
        // "shell-row" extracts the comment's backtick-wrapped word itself —
        // a one-word string that can never contain max-w-/px- — and the
        // guard above would pass no matter what the real className said.
        const fixture = [
            "{/* `shell-row` (globals.css) owns the width and the gutter */}",
            '<div className="shell-row max-w-6xl flex">',
        ].join("\n");
        const decls = shellRowDeclarationsIn(fixture);
        assert.equal(decls.length, 1, "the comment must not be counted as a declaration");
        assert.equal(decls[0], "shell-row max-w-6xl flex", "must extract the real className, not the comment");
        assert.match(decls[0], MAX_W_PROBE, "the real violation must still be visible once extracted correctly");
    });

    it("finds the shell-row declaration regardless of the surrounding call syntax", () => {
        // The bug instance: a bare attribute.
        assert.deepEqual(
            shellRowDeclarationsIn(`<div className="shell-row flex items-center">`),
            ["shell-row flex items-center"],
        );
        // The regression: shell-row as a cn(...) argument (jobs/page.tsx's shape).
        assert.deepEqual(
            shellRowDeclarationsIn(`className={cn("shell-row flex min-h-0 flex-col pt-2 sm:pt-3", extra)}`),
            ["shell-row flex min-h-0 flex-col pt-2 sm:pt-3"],
        );
        // A case OTHER than either of the above: a template-literal call,
        // which neither the original `className="..."` regex nor a
        // cn(...)-specific patch would catch.
        assert.deepEqual(
            shellRowDeclarationsIn("className={cn(`shell-row flex gap-2`, extra)}"),
            ["shell-row flex gap-2"],
        );
    });

    it("catches a max-width smuggled into a SIBLING cn(...) argument, not just the shell-row literal itself", () => {
        // Non-vacuity proof, the sibling-argument shape specifically: the
        // forbidden class lives in a DIFFERENT string literal than the one
        // that says "shell-row" — an extractor that returns only the
        // shell-row-bearing literal never sees it.
        const decls = shellRowDeclarationsIn(`className={cn("shell-row flex pt-2", isWide && "max-w-6xl")}`);
        assert.equal(decls.length, 1);
        assert.match(decls[0], MAX_W_PROBE, "a hardcoded max-w- in a sibling cn(...) argument must still trip the guard");
    });

    it("/jobs asks for the full window rather than assuming it", () => {
        assert.match(JOBS, /data-shell="bleed"/, "the page must declare the bleed for the chrome to follow");
        assertAllShellRowsClean(JOBS, "jobs main");
    });

    it("the max-width guard can actually detect a max-width", () => {
        // Without this the assertions above would pass on an empty string.
        assert.match("flex w-full max-w-6xl xl:max-w-7xl", MAX_W_PROBE);
        assert.match("relative xl:max-w-7xl flex", MAX_W_PROBE);
        assert.doesNotMatch("shell-row relative flex h-16 items-center", MAX_W_PROBE);
    });
});
