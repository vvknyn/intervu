import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHIP = join(__dirname, "..", "..", "src", "components", "ui", "chip.tsx");
const FILTER_CHIPS_ROW = join(__dirname, "..", "..", "src", "components", "jobs", "FilterChipsRow.tsx");
const PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "JobsContent.tsx");
const TOPBAR = join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx");
const SAVED_SEARCHES = join(__dirname, "..", "..", "src", "components", "jobs", "SavedSearchesPanel.tsx");
const GLOBALS = join(__dirname, "..", "..", "src", "app", "globals.css");

const CHANGED = [CHIP, FILTER_CHIPS_ROW, PAGE, TOPBAR, SAVED_SEARCHES, GLOBALS];

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
        assert.match(src, /!headerDockActive && activeEntries\.map/);
        assert.match(src, /data-testid="active-filter-chip"/);

        const activeRow = src.slice(
            src.indexOf('data-testid="active-filter-row"'),
            src.indexOf('data-testid="active-filter-row"') + 700,
        );
        // Below @2xl the chip row is its own sideways-scrolling line, so what narrows the list
        // never sits off-screen to the right of Sort; from @2xl it wraps under the controls.
        assert.match(activeRow, /@2xl:flex-wrap/);
        assert.match(activeRow, /@2xl:overflow-x-clip/);
        assert.match(activeRow, /\boverflow-x-auto/);
        assert.doesNotMatch(activeRow, /flex-nowrap/);

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
        assert.match(toolbarScroller, /@2xl:flex-wrap/);
        assert.match(toolbarScroller, /@2xl:overflow-x-clip/);
        // narrow column: the controls scroll on their own line; the chips scroll on theirs
        assert.match(toolbarScroller, /\boverflow-x-auto/);
        assert.doesNotMatch(toolbarScroller, /flex-nowrap/);
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
        const activeIdx = dockedRow.indexOf("topbar-docked-active-filters");
        const clearIdx = dockedRow.indexOf("topbar-docked-clear-filters");
        const saveIdx = dockedRow.indexOf("topbar-docked-save-search");
        const spacerIdx = dockedRow.indexOf("min-w-0 flex-1");
        assert.ok(filtersToggleIdx > -1 && fieldIdx > -1 && activeIdx > -1 && clearIdx > -1 && saveIdx > -1 && spacerIdx > -1);
        assert.ok(filtersToggleIdx < fieldIdx, "docked filters-toggle leads the left cluster");
        assert.ok(fieldIdx < activeIdx, "docked field-directory before the applied chips");
        assert.ok(activeIdx < clearIdx, "docked active-filters before clear-filters");
        assert.ok(clearIdx < spacerIdx && spacerIdx < saveIdx, "docked Clear then spacer then Save");
        assert.ok(filtersToggleIdx < clearIdx, "docked filters-toggle must not sit after Clear");
        assert.doesNotMatch(dockedRow, /topbar-docked-facets/, "no filter has a dropdown chip in the header any more");

        const toolbar = page.slice(page.indexOf('data-testid="jobs-toolbar"'), page.indexOf('data-testid="active-filter-row"'));
        const filterChipsRowIdx = toolbar.indexOf("<FilterChipsRow");
        const fieldDirectoryIdx = toolbar.indexOf("fieldDirectoryMenu");
        const filtersToggleIdxUndocked = toolbar.indexOf('data-testid="filters-toggle"');
        assert.equal(filterChipsRowIdx, -1, "undocked toolbar must not mount FilterChipsRow");
        assert.ok(filtersToggleIdxUndocked > -1, "undocked filters-toggle present");
        assert.ok(filtersToggleIdxUndocked < fieldDirectoryIdx, "undocked filters-toggle before fieldDirectory");

        const activeRow = page.slice(
            page.indexOf('data-testid="active-filter-row"'),
            page.indexOf('data-testid="active-filter-row"') + 2400,
        );
        assert.match(activeRow, /activeEntries\.map/);
        assert.match(activeRow, /\{barClearEl\}/);
        assert.ok(
            activeRow.indexOf("activeEntries.map") < activeRow.indexOf("{barClearEl}"),
            "Clear trails the applied chips",
        );
        assert.match(
            page,
            /const barClearEl = railOnScreen \? null : clearFiltersEl;/,
            "with the rail on screen Clear lives in the rail header, so the bar carries none",
        );
    });

    it("TopBar docked band wraps active chips", () => {
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
        assert.match(bandRow, /flex-wrap/);
        assert.match(bandRow, /overflow-x-clip/);
        assert.doesNotMatch(bandRow, /overflow-x-auto/);

        const dockedChip = src.slice(
            src.indexOf('data-testid="topbar-docked-chip"'),
            src.indexOf('data-testid="topbar-docked-chip"') + 400,
        );
        assert.match(dockedChip, /title=\{chip\.label\}/);
    });

    it("globals.css hides empty docked portal mounts", () => {
        const src = readFileSync(GLOBALS, "utf8");
        assert.match(src, /\[data-testid="topbar-docked-field-directory"\]:empty/);
        assert.doesNotMatch(src, /topbar-docked-facets/);
        assert.match(src, /\[data-testid="topbar-docked-clear-filters"\]:empty/);
        assert.match(src, /\[data-testid="topbar-docked-save-search"\]:empty/);
        assert.match(src, /\[data-testid="topbar-docked-sort"\]:empty/);
        assert.match(src, /\[data-testid="topbar-docked-extras"\]:empty/);
    });

    it("undocked actions cluster keeps to the trailing edge with ml-auto, not a spacer", () => {
        const page = readFileSync(PAGE, "utf8");
        const toolbar = page.slice(page.indexOf('data-testid="jobs-toolbar"'), page.indexOf('data-testid="active-filter-row"'));
        const actionsIdx = toolbar.indexOf('data-testid="jobs-toolbar-actions"');
        assert.ok(actionsIdx > -1);
        // An empty flex-1 spacer takes a row gap of its own, which stranded the
        // "?" on a 390px phone (J-NAV-35); the margin takes none.
        assert.match(toolbar.slice(actionsIdx, actionsIdx + 120), /className="ml-auto flex [^"]*\bgap-2\b/);
        // Rank and Sort sit in display:contents wrappers at lg, where wrap-row's child margins no longer apply:
        // the gap token on the cluster is what separates them.
        assert.doesNotMatch(toolbar.slice(actionsIdx, actionsIdx + 120), /wrap-row/);
        assert.doesNotMatch(toolbar, /<div className="min-w-0 flex-1" aria-hidden \/>/);
        assert.match(toolbar.slice(actionsIdx, actionsIdx + 400), /savedSearchMountEl/);
        assert.match(toolbar.slice(actionsIdx, actionsIdx + 400), /\{sortEl\}/);
    });

    it("Filters toggle is active only when expanded, not when filter count is nonzero", () => {
        const page = readFileSync(PAGE, "utf8");
        const topbar = readFileSync(TOPBAR, "utf8");
        const pageActive = chipVariantsActiveValues(page);
        const topbarActive = chipVariantsActiveValues(topbar);

        assert.ok(
            pageActive.includes("filtersShown"),
            "the undocked Filters toggle should key off whether the filters are on screen alone",
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

        // The résumé's state is said once, on the list's status line (list-header.ts); the toolbar carries no "Replace" or as-of text.
        assert.doesNotMatch(page, /data-testid="resume-as-of"|data-testid="jobs-replace-resume"/);
        const strip = page.slice(page.indexOf('data-testid="resume-read-strip"'), page.indexOf('data-testid="resume-read-strip"') + 1500);
        // The strip is the way to change the résumé (and, for a guest, to forget it): "Edit résumé" and Remove, inline text
        // that wraps like a sentence (`DotSeparated`: a dot never leads a line). The count above it already says the list is
        // ranked by the résumé, so the strip no longer restates "Ranked by your résumé" or a truncated résumé title: both
        // are in its hover title (`resumeReadText`).
        assert.match(strip, /title=\{`\$\{resumeReadText\} · \$\{displayResumeLabel\(resumeSourceLabel, resume\)\}`\}/);
        assert.match(strip, /<DotSeparated/);
        assert.match(strip, /href="\/resume"/);
        assert.match(strip, /Edit résumé/);
        assert.match(strip, /<ResumeRemove/);
        assert.doesNotMatch(strip, /flex-wrap|truncate|StripDot/);
        assert.doesNotMatch(page, /data-testid="resume-read-detail"|RESUME_READ_LABEL\}/);
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
