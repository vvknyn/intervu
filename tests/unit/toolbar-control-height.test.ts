import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The results toolbar renders one row of peer controls: the facet dropdowns,
 * "All filters", the résumé control, the active-filter chips, the geo-default
 * chip, and the Sort/Layout segmented groups.
 *
 * Measured on 2026-08-24 that row rendered THREE different box heights at
 * 1512px — 28px chips, a 34px segmented group and a 36px "All filters" — and
 * on a phone the geo-default chip sat at 28px beside 44px peers, because it
 * was the one control that never got the mobile bump. Nothing was broken;
 * each call site had simply picked its own `h-*` and they drifted apart.
 *
 * So the guard is not "those three controls are 28px" — that would only re-fix
 * the instances. It is "no control in that row states its own height": every
 * one of them composes the shared `toolbarControlHeight` token, which is the
 * only thing that keeps a control added next year agreeing with the rest.
 */

const PAGE = path.join(process.cwd(), "src/app/jobs/JobsContent.tsx");
const SHARED = path.join(process.cwd(), "src/lib/jobs/toolbar-control-height.ts");
const FILTER_CHIPS = path.join(process.cwd(), "src/components/jobs/FilterChipsRow.tsx");
const SAVED_SEARCHES = path.join(process.cwd(), "src/components/jobs/SavedSearchesPanel.tsx");
const pageSrc = readFileSync(PAGE, "utf8");
const sharedSrc = readFileSync(SHARED, "utf8");
const filterChipsSrc = readFileSync(FILTER_CHIPS, "utf8");
const savedSearchesSrc = readFileSync(SAVED_SEARCHES, "utf8");
const src = pageSrc;

/** A Tailwind height utility at any breakpoint — `h-7`, `lg:h-9`, `h-[46px]`. */
const HEIGHT_UTIL = /(?:^|[\s"'`])(?:sm:|md:|lg:|xl:|2xl:)?h-(?:\d|\[)/;

/**
 * The `className={cn( … )}` expression each `chipVariants(` sits inside,
 * found by balancing braces from the `className={` that precedes it rather
 * than by a fixed-size text window — a window would quietly stop covering a
 * call site the moment someone reformatted it.
 */
function classNameBlockAt(open: number): string | null {
    if (open === -1) return null;
    let depth = 0;
    for (let j = open + "className=".length; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) return src.slice(open, j + 1);
    }
    return null;
}

function classNameBlocksContaining(needle: string): string[] {
    const blocks: string[] = [];
    for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
        const block = classNameBlockAt(src.lastIndexOf("className={", i));
        if (block && block.includes(needle) && !blocks.includes(block)) blocks.push(block);
    }
    return blocks;
}

test("toolbar control height", async (t) => {
    await t.test("the shared token is the row's single source of height", () => {
        const decl = /export const toolbarControlHeight =\s*"([^"]+)"/.exec(sharedSrc);
        assert.ok(decl, "toolbarControlHeight must exist — it is what the row aligns on");
        // The control scale's md step (globals.css `.ctl-md`): the same visual
        // height at every width; the phone's 44px tap target is a hit area.
        assert.equal(decl![1], "ctl-md");
        assert.match(pageSrc, /from "@\/lib\/jobs\/toolbar-control-height"/);
    });

    await t.test("no chip in the toolbar states its own height", () => {
        const blocks = classNameBlocksContaining("chipVariants(");
        // If this ever reads 0, the scan stopped finding the call sites and
        // every assertion below would pass vacuously.
        assert.ok(blocks.length >= 4, `expected to find the chip call sites, found ${blocks.length}`);

        const offenders = blocks.filter((b) => HEIGHT_UTIL.test(b));
        assert.deepEqual(
            offenders.map((b) => b.replace(/\s+/g, " ").slice(0, 110)),
            [],
            "a toolbar chip hardcodes a height instead of composing toolbarControlHeight",
        );

        const untokened = blocks.filter(
            (b) => !b.includes("toolbarControlHeight") && !b.includes("toolbarChipClass"),
        );
        assert.deepEqual(
            untokened.map((b) => b.replace(/\s+/g, " ").slice(0, 110)),
            [],
            "a toolbar chip takes neither toolbarControlHeight nor toolbarChipClass",
        );
    });

    await t.test("the toolbar scroller is one scrollable row at every width", () => {
        const scroller = pageSrc.slice(
            pageSrc.indexOf('data-testid="jobs-toolbar-scroller"'),
            pageSrc.indexOf('data-testid="jobs-toolbar-scroller"') + 300,
        );
        assert.doesNotMatch(scroller, /flex-wrap|overflow-x-/);
        // The scrolling lives on the wrapper shared with the active chips (CHIP_SCROLL_ROW, every width).
        const rows = pageSrc.slice(pageSrc.indexOf('data-testid="jobs-toolbar-rows"'), pageSrc.indexOf('data-testid="jobs-toolbar-rows"') + 300);
        assert.match(rows, /CHIP_SCROLL_ROW/);
    });

    await t.test("FilterChipsRow is a nowrap chip rail, not a 3-column grid", () => {
        assert.doesNotMatch(filterChipsSrc, /grid-cols-3/);
        assert.doesNotMatch(filterChipsSrc, /w-full justify-center/);
        assert.match(filterChipsSrc, /flex shrink-0 items-center/);
        assert.match(filterChipsSrc, /toolbarChipClass/);
    });

    await t.test("compact SavedSearchesPanel wraps inside the toolbar scroller", () => {
        assert.match(savedSearchesSrc, /compact \? "min-w-0 flex-wrap" : "flex-wrap"/);
        assert.match(savedSearchesSrc, /compact \? "min-w-0 flex-wrap" : "flex-wrap"\)/);
        const savedItemBlock = savedSearchesSrc.slice(
            savedSearchesSrc.indexOf('data-testid="saved-search-item"'),
            savedSearchesSrc.indexOf('data-testid="saved-search-item"') + 800,
        );
        assert.match(savedItemBlock, /truncate/);
        assert.match(savedItemBlock, /title=\{s\.name\}/, "saved-search name button exposes full label via title");
    });
});
