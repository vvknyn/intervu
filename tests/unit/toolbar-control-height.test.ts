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

const PAGE = path.join(process.cwd(), "src/app/jobs/page.tsx");
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
        // 44px is the phone tap-target floor the mobile chips already used;
        // 28px from `lg` is the `chipVariants` density the rest of the app is
        // built on. Both halves are load-bearing, so both are pinned here.
        assert.equal(decl![1], "h-11 lg:h-8");
        assert.match(pageSrc, /from "@\/lib\/jobs\/toolbar-control-height"/);
    });

    await t.test("no chip in the toolbar states its own height", () => {
        const blocks = classNameBlocksContaining("chipVariants(");
        // If this ever reads 0, the scan stopped finding the call sites and
        // every assertion below would pass vacuously.
        assert.ok(blocks.length >= 6, `expected to find the chip call sites, found ${blocks.length}`);

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

    await t.test("the two segmented groups are written once, not twice", () => {
        assert.match(sharedSrc, /export const toolbarSegmentGroupClass =/);
        // Sort and Layout previously carried byte-identical class strings, so
        // a change to one silently left the other behind.
        const uses = pageSrc.match(/toolbarSegmentGroupClass/g) ?? [];
        assert.equal(uses.length, 2, "expected one import and both groups using it");
    });

    await t.test("a segment fills its group rather than fixing its own height", () => {
        // The group owns the height; `self-stretch` is what lets a 24px segment
        // sit inside a 28px frame without the two disagreeing.
        const start = src.indexOf("function ToolbarSegment");
        assert.notEqual(start, -1, "ToolbarSegment must exist");
        const seg = classNameBlockAt(src.indexOf("className={", start));
        assert.ok(seg, "ToolbarSegment must style itself through a className expression");
        assert.match(seg!, /self-stretch/);
        assert.match(seg!, /items-center/, "stretched segments must flex-center their label");
        assert.match(seg!, /leading-none/, "uppercase labels need a flush line-box or they sit high");
        assert.doesNotMatch(seg!, HEIGHT_UTIL);
    });

    await t.test("the toolbar scroller stays one nowrap row at every breakpoint", () => {
        const toolbar = pageSrc.slice(pageSrc.indexOf('data-testid="jobs-toolbar"'));
        const scroller = toolbar.slice(
            toolbar.indexOf("showJobsToolbarRow && ("),
            toolbar.indexOf("{facetsMountSite ==="),
        );
        assert.match(scroller, /flex-nowrap/);
        assert.match(scroller, /overflow-x-auto/);
        assert.doesNotMatch(scroller, /flex-wrap/);
    });

    await t.test("FilterChipsRow is a nowrap chip rail, not a 3-column grid", () => {
        assert.doesNotMatch(filterChipsSrc, /grid-cols-3/);
        assert.doesNotMatch(filterChipsSrc, /w-full justify-center/);
        assert.match(filterChipsSrc, /flex shrink-0 items-stretch/);
        assert.match(filterChipsSrc, /toolbarChipClass/);
    });

    await t.test("compact SavedSearchesPanel stays nowrap inside the toolbar scroller", () => {
        assert.match(savedSearchesSrc, /compact \? "shrink-0 flex-nowrap" : "flex-wrap"/);
        assert.match(savedSearchesSrc, /compact \? "shrink-0 flex-nowrap" : "flex-wrap"\)/);
    });
});
