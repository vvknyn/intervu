import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PRISTINE_FILTER_STATE, type FilterState } from "../../src/components/jobs/FilterPanel";

const CHIP = join(__dirname, "..", "..", "src", "components", "ui", "chip.tsx");
const FILTER_CHIPS_ROW = join(__dirname, "..", "..", "src", "components", "jobs", "FilterChipsRow.tsx");
const PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "JobsContent.tsx");
const TOPBAR = join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx");
const SAVED_SEARCHES = join(__dirname, "..", "..", "src", "components", "jobs", "SavedSearchesPanel.tsx");
const GLOBALS = join(__dirname, "..", "..", "src", "app", "globals.css");

const CHANGED = [CHIP, FILTER_CHIPS_ROW, PAGE, TOPBAR, SAVED_SEARCHES, GLOBALS];

const pristine: FilterState = { ...PRISTINE_FILTER_STATE };

/**
 * The element whose opening tag contains `marker`, from that tag through the matching close.
 * Comments are skipped so a comment that mentions the tag cannot move the close.
 */
function elementByMarker(source: string, marker: string): { innerStart: number; close: number } {
    const markerAt = source.indexOf(marker);
    assert.ok(markerAt !== -1, marker);
    const open = source.lastIndexOf("<", markerAt);
    const tag = /^<([A-Za-z][\w.-]*)/.exec(source.slice(open))?.[1];
    assert.ok(tag, "opening tag");
    const openEnd = source.indexOf(">", open);
    assert.ok(openEnd > markerAt, "opening tag ends after the marker");
    if (source[openEnd - 1] === "/") return { innerStart: openEnd + 1, close: openEnd + 1 };
    let depth = 1;
    let i = openEnd + 1;
    while (i < source.length && depth > 0) {
        if (source.startsWith("<!--", i)) {
            const end = source.indexOf("-->", i + 4);
            i = end === -1 ? source.length : end + 3;
            continue;
        }
        if (source[i] !== "<") {
            i++;
            continue;
        }
        const isClose = source.startsWith(`</${tag}`, i) && /[\s>]/.test(source[i + tag.length + 2] ?? "");
        const isOpen = source.startsWith(`<${tag}`, i) && /[\s>/]/.test(source[i + tag.length + 1] ?? "");
        if (isClose || isOpen) {
            const end = source.indexOf(">", i);
            assert.ok(end !== -1, "tag ends");
            if (isClose) depth--;
            else if (source[end - 1] !== "/") depth++;
            if (depth === 0) return { innerStart: openEnd + 1, close: i };
            i = end + 1;
            continue;
        }
        i++;
    }
    assert.fail(`unclosed <${tag}> for ${marker}`);
}

/**
 * Every `chipVariants({...})` call's `active:` value, verbatim — regardless
 * of key order or how many other keys (e.g. `interactive: true`) share the
 * object literal. Assertions below match on the VALUE, not the literal
 * object text, so an unrelated key added to the call can't break them.
 */
function chipVariantsActiveValues(src: string): string[] {
    const values: string[] = [];
    const callRe = /chipVariants\(\{([^{}]*)\}\)/g;
    let call: RegExpExecArray | null;
    while ((call = callRe.exec(src))) {
        const props = call[1];
        let depth = 0;
        let start = 0;
        const parts: string[] = [];
        for (let i = 0; i < props.length; i++) {
            const ch = props[i];
            if (ch === "(" || ch === "[") depth++;
            else if (ch === ")" || ch === "]") depth--;
            else if (ch === "," && depth === 0) {
                parts.push(props.slice(start, i));
                start = i + 1;
            }
        }
        parts.push(props.slice(start));
        for (const part of parts) {
            const m = part.match(/^\s*active\s*:\s*(.*?)\s*$/);
            if (m) values.push(m[1]);
        }
    }
    return values;
}

describe("jobs filter toolbar chrome", () => {
    it("chipVariantsActiveValues reads `active` by key, not position or exclusivity", () => {
        assert.deepEqual(
            chipVariantsActiveValues("chipVariants({ interactive: true, active: x })"),
            ["x"],
            "active listed after another key must still be found",
        );
        assert.deepEqual(
            chipVariantsActiveValues("chipVariants({ active: a || b, interactive: true })"),
            ["a || b"],
            "a compound active expression must not be cut off at its own || or at the next key",
        );
    });

    // #537 (ba9603bf) replaced the squared 3px brand blade with pill chips;
    // e8aa53a1 moved the count badge onto the shared solid-badge primitive.
    it("chip is a borderless tonal pill: active is a brand-tint fill with brand text (calm pass R5)", () => {
        const src = readFileSync(CHIP, "utf8");
        assert.match(src, /rounded-pill/);
        assert.match(src, /true: "bg-live-tint-bg text-brand"/);
        assert.doesNotMatch(src, /border-border/);
        assert.match(src, /motion-reduce:transition-none/);
        assert.doesNotMatch(src, /rounded-full/);
        assert.doesNotMatch(src, /bg-brand text-brand-foreground/);
    });

    it("exports shared filterCountBadgeClass on the neutral solid badge", () => {
        const src = readFileSync(CHIP, "utf8");
        assert.match(src, /export const filterCountBadgeClass = solidBadgeVariants\(\{ tone: "muted" \}\)/);
    });

    it("FilterChipsRow does not override chipVariants active/inactive styling", () => {
        const src = readFileSync(FILTER_CHIPS_ROW, "utf8");
        assert.doesNotMatch(src, /!active && "border-foreground bg-background text-foreground"/);
        assert.doesNotMatch(src, /active && "border-brand bg-muted text-brand"/);
    });

    it("page.tsx renders distinct active-filter row with required source patterns", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /data-testid="active-filter-row"/);
        assert.match(src, /\{activeEntries\.map\(\(entry\) =>/);
        assert.match(src, /data-testid="active-filter-chip"/);

        const activeRow = src.slice(
            src.indexOf('data-testid="active-filter-row"'),
            src.indexOf('data-testid="active-filter-row"') + 700,
        );
        // Scrolling and nowrap live on the shared CHIP_SCROLL_ROW wrapper, never on this inner group.
        assert.doesNotMatch(activeRow, /flex-wrap|overflow-x-/);

        const activeChip = src.slice(
            src.indexOf('data-testid="active-filter-chip"'),
            src.indexOf('data-testid="active-filter-chip"') + 500,
        );
        assert.doesNotMatch(activeChip, /truncate/); // chips never truncate (U8)
        assert.match(activeChip, /title=\{label\}/);

        const toolbarScroller = src.slice(
            src.indexOf('data-testid="jobs-toolbar-scroller"'),
            src.indexOf('data-testid="jobs-toolbar-scroller"') + 300,
        );
        assert.doesNotMatch(toolbarScroller, /flex-wrap|overflow-x-/);
        // one scrollable row at every width, shared with the active chips (the wrapper scrolls)
        assert.match(src.slice(src.indexOf('data-testid="jobs-toolbar-rows"'), src.indexOf('data-testid="jobs-toolbar-rows"') + 300), /CHIP_SCROLL_ROW/);
    });

    it("Clear sits at the trailing end of the filter/chip cluster, not between chips and Save", () => {
        const topbar = readFileSync(TOPBAR, "utf8");
        const page = readFileSync(PAGE, "utf8");
        const dockedRow = topbar.slice(
            topbar.indexOf('data-testid="topbar-docked-filters-toggle"'),
            topbar.indexOf('data-testid="topbar-docked-extras"'),
        );
        const filtersToggleIdx = dockedRow.indexOf("topbar-docked-filters-toggle");
        const fieldIdx = dockedRow.indexOf("topbar-docked-field-directory");
        const facetsIdx = dockedRow.indexOf("topbar-docked-facets");
        const activeIdx = dockedRow.indexOf("topbar-docked-active-filters");
        const clearIdx = dockedRow.indexOf("topbar-docked-clear-filters");
        const saveIdx = dockedRow.indexOf("topbar-docked-save-search");
        const spacerIdx = dockedRow.indexOf("min-w-0 flex-1");
        assert.ok(filtersToggleIdx > -1 && fieldIdx > -1 && facetsIdx > -1 && clearIdx > -1 && saveIdx > -1 && spacerIdx > -1);
        assert.ok(filtersToggleIdx < fieldIdx, "docked filters-toggle leads the left cluster");
        assert.ok(fieldIdx < facetsIdx, "docked field-directory before facets");
        assert.ok(facetsIdx < clearIdx, "docked facets before clear-filters");
        if (activeIdx > -1) {
            assert.ok(facetsIdx < activeIdx && activeIdx < clearIdx, "docked active-filters between facets and clear");
        }
        assert.ok(clearIdx < spacerIdx && spacerIdx < saveIdx, "docked Clear then spacer then Save");
        assert.ok(
            filtersToggleIdx < fieldIdx && filtersToggleIdx < facetsIdx,
            "docked filters-toggle must not sit between field-directory and facets",
        );
        assert.ok(
            filtersToggleIdx < clearIdx,
            "docked filters-toggle must not sit after Clear",
        );

        const toolbar = page.slice(page.indexOf('data-testid="jobs-toolbar"'), page.indexOf('data-testid="active-filter-row"'));
        const filterChipsRowIdx = toolbar.indexOf("<FilterChipsRow");
        const fieldDirectoryIdx = toolbar.indexOf("fieldDirectoryMenu");
        const filtersToggleIdxUndocked = toolbar.indexOf('data-testid="filters-toggle"');
        assert.equal(filterChipsRowIdx, -1, "undocked toolbar must not mount FilterChipsRow");
        assert.ok(filtersToggleIdxUndocked > -1, "undocked filters-toggle present");
        assert.ok(filtersToggleIdxUndocked < fieldDirectoryIdx, "undocked filters-toggle before fieldDirectory");
        assert.doesNotMatch(toolbar, /facetBarEl|FacetBar/, "Filters is the one filter entry point: no facet dropdowns");
        assert.doesNotMatch(toolbar, /clearFiltersEl/, "Clear trails the chip row, not the controls row");

        const activeRow = page.slice(
            page.indexOf('data-testid="active-filter-row"'),
            page.indexOf("{facetsMountSite ==="),
        );
        assert.match(activeRow, /activeEntries\.map/);
        assert.match(activeRow, /\{clearFiltersEl\}/);
        assert.ok(
            activeRow.indexOf("activeEntries.map") < activeRow.indexOf("{clearFiltersEl}"),
            "Clear trails the chip row",
        );
    });

    it("TopBar docked band keeps active chips on one scrolling line", () => {
        const src = readFileSync(TOPBAR, "utf8");
        assert.match(src, /data-testid="topbar-docked-active-filters"/);
        assert.ok(
            chipVariantsActiveValues(src).includes("true"),
            "a docked active-filter chip should render chipVariants({ active: true, ...}) — an already-applied filter is unconditionally active",
        );
        assert.match(src, /<SolidBadge tone="muted"/);
        assert.match(src, /data-region="band" className="hidden lg:block"/);

        const bandRow = src.slice(
            src.indexOf('data-region="band"'),
            src.indexOf('data-testid="topbar-docked-filters-toggle"') + 80,
        );
        assert.match(bandRow, /CHIP_SCROLL_ROW/, "the docked row is the shared one-line scrolling chip row");
        assert.doesNotMatch(bandRow, /flex-wrap/);

        const dockedChip = src.slice(
            src.indexOf('data-testid="topbar-docked-chip"'),
            src.indexOf('data-testid="topbar-docked-chip"') + 400,
        );
        assert.match(dockedChip, /title=\{chip\.label\}/);
    });

    it("globals.css hides empty docked portal mounts", () => {
        const src = readFileSync(GLOBALS, "utf8");
        assert.match(src, /\[data-testid="topbar-docked-field-directory"\]:empty/);
        assert.match(src, /\[data-testid="topbar-docked-facets"\]:empty/);
        assert.match(src, /\[data-testid="topbar-docked-clear-filters"\]:empty/);
        assert.match(src, /\[data-testid="topbar-docked-save-search"\]:empty/);
        assert.match(src, /\[data-testid="topbar-docked-sort"\]:empty/);
        assert.match(src, /\[data-testid="topbar-docked-extras"\]:empty/);
    });

    it("Sort sits on the results line, right of the count; row 1 keeps only search and Filters", () => {
        const page = readFileSync(PAGE, "utf8");
        const toolbar = page.slice(page.indexOf('data-testid="jobs-toolbar"'), page.indexOf('data-testid="active-filter-row"'));
        assert.doesNotMatch(toolbar, /jobs-toolbar-actions|\{sortEl\}|rankByFitEl|savedSearchControl/);
        assert.doesNotMatch(page, /createPortal\(sortEl|createPortal\(savedSearchMountEl/, "the docked header no longer mounts Sort or Rank");
        // The relationship, not a character budget: Sort is inside the results bar, to the right of the count,
        // and the résumé caption is the next sibling after that bar. A longer bar must not move Sort "out".
        const bar = elementByMarker(page, 'data-testid="results-bar"');
        const inner = page.slice(bar.innerStart, bar.close);
        const countAt = inner.indexOf('data-testid="result-line"');
        const sortAt = inner.indexOf("{sortEl}");
        assert.ok(countAt !== -1 && sortAt > countAt, "the count and Sort are inside the results line, count on the left");
        const afterBar = page.slice(bar.close).replace(/^<\/div>/, "");
        assert.match(afterBar, /^\s*\{resumeReadStripEl\}/, "the résumé caption is the next sibling under the results line");
    });

    it("Filters toggle is active only when expanded, not when filter count is nonzero", () => {
        const page = readFileSync(PAGE, "utf8");
        const topbar = readFileSync(TOPBAR, "utf8");
        const pageActive = chipVariantsActiveValues(page);
        const topbarActive = chipVariantsActiveValues(topbar);

        assert.ok(
            pageActive.includes("filtersOpen"),
            "the undocked Filters toggle should key off filtersOpen alone",
        );
        assert.ok(
            topbarActive.includes("docked.filtersExpanded"),
            "the docked Filters toggle should key off docked.filtersExpanded alone",
        );
        for (const value of [...pageActive, ...topbarActive]) {
            assert.doesNotMatch(
                value,
                /activeCount|filterCount/,
                `chipVariants active value "${value}" folds a filter count into the toggle's active state`,
            );
        }
    });

    it("Rank by fit is the outlined action Button, compact Save search uses quiet text, neither uses chipVariants", () => {
        const page = readFileSync(PAGE, "utf8");
        const saved = readFileSync(SAVED_SEARCHES, "utf8");
        const rankAt = page.indexOf('data-testid="jobs-rank-by-fit"');
        const rankBlock = page.slice(page.lastIndexOf("<Button", rankAt), rankAt + 350);
        assert.doesNotMatch(rankBlock, /chipVariants/);
        // The outlined action of the detail pane's "Customize résumé" (same Button variant and size token).
        assert.match(rankBlock, /variant="outline"/);
        assert.match(rankBlock, /size=\{jobActionSize\}/);
        assert.doesNotMatch(rankBlock, /\btext-(?:xs|sm)\b|\bfont-semibold\b/);

        // One résumé-state strip above the list; the toolbar carries no "Replace" or as-of text.
        assert.doesNotMatch(page, /data-testid="resume-as-of"|data-testid="jobs-replace-resume"/);
        const strip = page.slice(page.indexOf('data-testid="resume-read-strip"'), page.indexOf('data-testid="resume-read-strip"') + 1700);
        assert.match(strip, /resumeReadDetailText/);
        // One line at any column width: the detail truncates, the action can never orphan onto a second line.
        assert.doesNotMatch(strip, /flex-wrap/);
        assert.match(strip.slice(strip.indexOf('data-testid="resume-read-detail"')), /^[^>]*className="min-w-0 truncate"/);
        assert.match(strip.slice(strip.indexOf('href="/resume"')), /^[^>]*className="shrink-0 whitespace-nowrap /);
        assert.match(strip, /href="\/resume"/);
        // Truncated detail stays readable on hover: the span's title is the same expression as its text.
        const detail = strip.slice(strip.indexOf('data-testid="resume-read-detail"'));
        assert.match(detail, /^[^>]*title=\{resumeReadDetailText\}/);
        // Separators are their own nodes (label · detail · Edit [· Remove]); the detail text stays bare, so it
        // truncates without eating the separator before Edit, with and without a detail.
        assert.match(detail, /^[^>]*>\{resumeReadDetailText\}<\/span>/);
        assert.doesNotMatch(detail.slice(0, detail.indexOf('</span>')), /·/);
        assert.equal((strip.match(/<StripDot \/>/g) ?? []).length, 3);
        assert.match(strip.slice(0, strip.indexOf('href="/resume"')), /<StripDot \/>\s*<Link\s*$/);
        assert.doesNotMatch(page, /update to rescore/);
        assert.doesNotMatch(page, /scored against your résumé of/);
        assert.doesNotMatch(page, /data-testid="jobs-sort-replace-resume"/);

        const saveTrigger = saved.slice(saved.indexOf('data-testid="save-search-trigger"'), saved.indexOf('data-testid="save-search-trigger"') + 450);
        assert.doesNotMatch(saveTrigger, /chipVariants/);
        assert.match(saveTrigger, /toolbarControlHeight/);
        assert.match(saveTrigger, /"ctl-button [^"]*text-foreground/);
        assert.doesNotMatch(saveTrigger, /\btext-(?:xs|sm)\b|\bfont-semibold\b/);
    });

    it("changed files do not touch JobDetail handoff or list-detail motion", () => {
        for (const file of CHANGED) {
            const src = readFileSync(file, "utf8");
            assert.doesNotMatch(src, /JobDetailHandoff/);
            assert.doesNotMatch(src, /clip-path/);
            assert.doesNotMatch(src, /list-detail overlap/i);
        }
    });
});
