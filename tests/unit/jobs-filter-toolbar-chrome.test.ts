import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    facetBarShouldRenderChip,
    hasStandingFacetSelection,
} from "../../src/components/jobs/FacetBar";
import { PRISTINE_FILTER_STATE, type FilterState } from "../../src/components/jobs/FilterPanel";

const CHIP = join(__dirname, "..", "..", "src", "components", "ui", "chip.tsx");
const FILTER_CHIPS_ROW = join(__dirname, "..", "..", "src", "components", "jobs", "FilterChipsRow.tsx");
const FACET_BAR = join(__dirname, "..", "..", "src", "components", "jobs", "FacetBar.tsx");
const PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "JobsContent.tsx");
const TOPBAR = join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx");
const SAVED_SEARCHES = join(__dirname, "..", "..", "src", "components", "jobs", "SavedSearchesPanel.tsx");
const GLOBALS = join(__dirname, "..", "..", "src", "app", "globals.css");

const CHANGED = [CHIP, FILTER_CHIPS_ROW, FACET_BAR, PAGE, TOPBAR, SAVED_SEARCHES, GLOBALS];

const pristine: FilterState = { ...PRISTINE_FILTER_STATE };

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
    it("chip is a neutral pill: active is a foreground border, never a brand fill", () => {
        const src = readFileSync(CHIP, "utf8");
        assert.match(src, /rounded-pill/);
        assert.match(src, /true: "border-foreground text-foreground"/);
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

    it("FacetBar trigger takes its type from the button face, like its toolbar peers", () => {
        // Was `text-xs` on every toolbar peer; since 2026-09-29 a button's type
        // comes from its step (`.ctl-button`, tests/unit/control-type.test.ts),
        // so the peers match by naming none.
        const src = readFileSync(FACET_BAR, "utf8");
        const facetChip = src.slice(src.indexOf("function FacetChip"), src.indexOf("function facetActiveValue"));
        assert.match(facetChip, /\bctl-button\b/);
        assert.doesNotMatch(facetChip, /\btext-(?:xs|sm|base)\b|\bfont-(?:normal|medium|semibold|bold)\b/);
    });

    it("FacetBar root is visible below lg (no hidden lg:flex)", () => {
        const src = readFileSync(FACET_BAR, "utf8");
        const root = src.slice(src.indexOf('data-testid="facet-bar"'), src.indexOf('data-testid="facet-bar"') + 120);
        assert.match(root, /flex flex-wrap/);
        assert.doesNotMatch(root, /hidden lg:flex/);
    });

    it("page.tsx renders distinct active-filter row with required source patterns", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /data-testid="active-filter-row"/);
        assert.match(src, /!headerDockActive && unnamedEntries\.map/);
        assert.match(src, /data-testid="active-filter-chip"/);

        const activeRow = src.slice(
            src.indexOf('data-testid="active-filter-row"'),
            src.indexOf('data-testid="active-filter-row"') + 700,
        );
        assert.match(activeRow, /flex-wrap/);
        assert.match(activeRow, /overflow-x-clip/);
        assert.doesNotMatch(activeRow, /flex-nowrap/);
        assert.doesNotMatch(activeRow, /overflow-x-auto/);

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
        assert.match(toolbarScroller, /flex-wrap/);
        assert.match(toolbarScroller, /overflow-x-clip/);
        // narrow column: one scrollable row, shared with the active chips (the wrapper scrolls)
        assert.match(src.slice(src.indexOf('data-testid="jobs-toolbar-rows"'), src.indexOf('data-testid="jobs-toolbar-rows"') + 300), /\boverflow-x-auto/);
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
        const facetBarIdx = toolbar.indexOf("facetBarEl");
        const inPageClear = toolbar.indexOf("unnamedEntries.length === 0 && clearFiltersEl");
        const filtersToggleIdxUndocked = toolbar.indexOf('data-testid="filters-toggle"');
        const inPageActions = toolbar.indexOf('data-testid="jobs-toolbar-actions"');
        assert.equal(filterChipsRowIdx, -1, "undocked toolbar must not mount FilterChipsRow");
        assert.ok(filtersToggleIdxUndocked > -1, "undocked filters-toggle present");
        assert.ok(filtersToggleIdxUndocked < fieldDirectoryIdx, "undocked filters-toggle before fieldDirectory");
        assert.ok(fieldDirectoryIdx > -1 && facetBarIdx > fieldDirectoryIdx, "undocked fieldDirectory before facetBar");
        assert.ok(
            filtersToggleIdxUndocked < fieldDirectoryIdx && filtersToggleIdxUndocked < facetBarIdx,
            "undocked filters-toggle must not sit between field-directory and facets",
        );
        assert.ok(inPageClear > -1 && inPageClear < inPageActions, "undocked clear before the actions cluster");

        const activeRow = page.slice(
            page.indexOf('data-testid="active-filter-row"'),
            page.indexOf("{facetsMountSite ==="),
        );
        assert.match(activeRow, /unnamedEntries\.map/);
        assert.match(activeRow, /\{clearFiltersEl\}/);
        assert.ok(
            activeRow.indexOf("unnamedEntries.map") < activeRow.indexOf("{clearFiltersEl}"),
            "when leftover chips have their own row, Clear trails that row",
        );
    });

    it("TopBar docked band wraps active chips with instrument rule", () => {
        const src = readFileSync(TOPBAR, "utf8");
        assert.match(src, /data-testid="topbar-docked-active-filters"/);
        assert.match(src, /jobs-instrument-rule/);
        assert.ok(
            chipVariantsActiveValues(src).includes("true"),
            "a docked active-filter chip should render chipVariants({ active: true, ...}) — an already-applied filter is unconditionally active",
        );
        assert.match(src, /<SolidBadge tone="muted"/);
        assert.match(src, /bg-muted lg:block/);

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

    it("globals.css defines jobs-instrument-rule and hides empty docked portal mounts", () => {
        const src = readFileSync(GLOBALS, "utf8");
        assert.match(src, /\.jobs-instrument-rule/);
        assert.match(src, /\[data-testid="topbar-docked-field-directory"\]:empty/);
        assert.match(src, /\[data-testid="topbar-docked-facets"\]:empty/);
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

    it("facetBarShouldRenderChip hides inactive standing facets and shows applied ones", () => {
        assert.equal(facetBarShouldRenderChip("postedBucket", pristine, true), true);
        assert.equal(facetBarShouldRenderChip("salaryMin", pristine, false), false);
        assert.equal(facetBarShouldRenderChip("work_type", pristine, true), false);
        assert.equal(facetBarShouldRenderChip("experience_level", pristine, true), false);
        assert.equal(hasStandingFacetSelection(pristine, true), true);

        const explicitAny: FilterState = { ...pristine, postedBucket: undefined, postedExplicit: true };
        assert.equal(facetBarShouldRenderChip("postedBucket", explicitAny, true), false);
        assert.equal(facetBarShouldRenderChip("postedBucket", pristine, false), false);

        const withPosted7d: FilterState = { ...pristine, postedBucket: "7d", postedExplicit: true };
        assert.equal(facetBarShouldRenderChip("postedBucket", withPosted7d, true), true);

        const withPosted30dExplicit: FilterState = { ...pristine, postedBucket: "30d", postedExplicit: true };
        assert.equal(facetBarShouldRenderChip("postedBucket", withPosted30dExplicit, true), true);

        const withSalary: FilterState = { ...pristine, salaryMin: 100_000 };
        assert.equal(facetBarShouldRenderChip("salaryMin", withSalary, true), true);

        const withWorkType: FilterState = { ...pristine, facets: { work_type: ["remote"] } };
        assert.equal(facetBarShouldRenderChip("work_type", withWorkType, true), true);

        const withExperience: FilterState = { ...pristine, facets: { experience_level: ["senior"] } };
        assert.equal(facetBarShouldRenderChip("experience_level", withExperience, true), true);
    });

    it("FacetBar posted chip visibility uses appliedPostedBucket, not activeFilterEntries", () => {
        const src = readFileSync(FACET_BAR, "utf8");
        const fn = src.slice(src.indexOf("export function facetBarShouldRenderChip"), src.indexOf("/** True when at least one"));
        assert.match(fn, /appliedPostedBucket\(state\)/);
        assert.doesNotMatch(fn, /activeFilterEntries/);
    });

    it("FacetBar returns null when no standing facet is applied (except quiet 30d posted default)", () => {
        const src = readFileSync(FACET_BAR, "utf8");
        assert.match(src, /hasStandingFacetSelection\(state, postedDateSupported\)\) return null/);
        assert.match(src, /facetBarShouldRenderChip\("postedBucket"/);
        assert.match(src, /facetBarShouldRenderChip\("salaryMin"/);
        assert.equal(hasStandingFacetSelection({ ...pristine, postedBucket: undefined, postedExplicit: true }, true), false);
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
        const strip = page.slice(page.indexOf('data-testid="resume-read-strip"'), page.indexOf('data-testid="resume-read-strip"') + 1100);
        assert.match(strip, /resumeReadDetailText/);
        // One line at any column width: the detail truncates, the action can never orphan onto a second line.
        assert.doesNotMatch(strip, /flex-wrap/);
        assert.match(strip.slice(strip.indexOf('data-testid="resume-read-detail"')), /^[^>]*className="min-w-0 truncate"/);
        assert.match(strip.slice(strip.indexOf('href="/resume"')), /^[^>]*className="shrink-0 whitespace-nowrap /);
        assert.match(strip, /href="\/resume"/);
        assert.doesNotMatch(page, /update to rescore/);
        assert.doesNotMatch(page, /scored against your résumé of/);
        assert.doesNotMatch(page, /data-testid="jobs-sort-replace-resume"/);

        const saveTrigger = saved.slice(saved.indexOf('data-testid="save-search-trigger"'), saved.indexOf('data-testid="save-search-trigger"') + 450);
        assert.doesNotMatch(saveTrigger, /chipVariants/);
        assert.match(saveTrigger, /toolbarControlHeight/);
        assert.match(saveTrigger, /"ctl-button [^"]*text-foreground/);
        assert.doesNotMatch(saveTrigger, /\btext-(?:xs|sm)\b|\bfont-semibold\b/);
    });

    it("shouldShowSearchAlertCapture call sites suppress while guest auth gate is visible", () => {
        const page = readFileSync(PAGE, "utf8");
        const authGatePattern = /authGateVisible:\s*showGuestSaveBanner/;
        const callSites = [...page.matchAll(/shouldShowSearchAlertCapture\(\{[\s\S]*?\}\)/g)];
        // One since 2026-10-10: with results the form opens only from the alerts
        // switch, so only the zero-results capture still decides for itself.
        assert.ok(callSites.length >= 1, "expected a shouldShowSearchAlertCapture call site");
        for (const match of callSites) {
            assert.match(match[0], authGatePattern, "each call site must pass authGateVisible from guest banners");
        }
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
