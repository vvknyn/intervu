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
const PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "page.tsx");
const TOPBAR = join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx");
const SAVED_SEARCHES = join(__dirname, "..", "..", "src", "components", "jobs", "SavedSearchesPanel.tsx");
const GLOBALS = join(__dirname, "..", "..", "src", "app", "globals.css");

const CHANGED = [CHIP, FILTER_CHIPS_ROW, FACET_BAR, PAGE, TOPBAR, SAVED_SEARCHES, GLOBALS];

const pristine: FilterState = { ...PRISTINE_FILTER_STATE };

describe("jobs filter toolbar chrome", () => {
    it("chip active variant uses a 3px brand blade, tinted fill, squared geometry", () => {
        const src = readFileSync(CHIP, "utf8");
        assert.match(src, /border-l-\[3px\]/);
        assert.match(src, /border-l-brand/);
        assert.match(src, /bg-brand\/\[0\.06\]/);
        assert.match(src, /rounded-none/);
        assert.match(src, /motion-reduce:transition-none/);
        assert.doesNotMatch(src, /rounded-full/);
        assert.doesNotMatch(src, /bg-brand text-brand-foreground/);
    });

    it("exports shared filterCountBadgeClass", () => {
        const src = readFileSync(CHIP, "utf8");
        assert.match(src, /export const filterCountBadgeClass/);
        assert.match(src, /rounded-none border border-brand bg-muted/);
    });

    it("FilterChipsRow does not override chipVariants active/inactive styling", () => {
        const src = readFileSync(FILTER_CHIPS_ROW, "utf8");
        assert.doesNotMatch(src, /!active && "border-foreground bg-background text-foreground"/);
        assert.doesNotMatch(src, /active && "border-brand bg-muted text-brand"/);
    });

    it("FacetBar trigger uses text-xs to match toolbar peers", () => {
        const src = readFileSync(FACET_BAR, "utf8");
        const facetChip = src.slice(src.indexOf("function FacetChip"), src.indexOf("function facetActiveValue"));
        assert.match(facetChip, /text-xs/);
    });

    it("FacetBar root is visible below lg (no hidden lg:flex)", () => {
        const src = readFileSync(FACET_BAR, "utf8");
        const root = src.slice(src.indexOf('data-testid="facet-bar"'), src.indexOf('data-testid="facet-bar"') + 120);
        assert.match(root, /flex flex-nowrap/);
        assert.doesNotMatch(root, /hidden lg:flex/);
    });

    it("page.tsx renders distinct active-filter row with required source patterns", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /data-testid="active-filter-row"/);
        assert.match(src, /!headerDockActive && unnamedEntries\.map/);
        assert.match(src, /data-testid="active-filter-chip"/);

        const activeRow = src.slice(
            src.indexOf('data-testid="active-filter-row"'),
            src.indexOf('data-testid="active-filter-row"') + 400,
        );
        assert.match(activeRow, /flex-nowrap/);
        assert.doesNotMatch(activeRow, /flex-wrap/);

        const toolbarScroller = src.slice(
            src.indexOf('data-testid="jobs-toolbar"'),
            src.indexOf('data-testid="active-filter-row"'),
        );
        assert.match(toolbarScroller, /flex-nowrap/);
        assert.match(toolbarScroller, /overflow-x-auto/);
        assert.doesNotMatch(toolbarScroller, /flex-wrap/);
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
        const inPageSpacer = toolbar.indexOf("min-w-0 flex-1");
        const inPageActions = toolbar.indexOf('data-testid="jobs-toolbar-actions"');
        assert.equal(filterChipsRowIdx, -1, "undocked toolbar must not mount FilterChipsRow");
        assert.ok(filtersToggleIdxUndocked > -1, "undocked filters-toggle present");
        assert.ok(filtersToggleIdxUndocked < fieldDirectoryIdx, "undocked filters-toggle before fieldDirectory");
        assert.ok(fieldDirectoryIdx > -1 && facetBarIdx > fieldDirectoryIdx, "undocked fieldDirectory before facetBar");
        assert.ok(
            filtersToggleIdxUndocked < fieldDirectoryIdx && filtersToggleIdxUndocked < facetBarIdx,
            "undocked filters-toggle must not sit between field-directory and facets",
        );
        assert.ok(inPageClear > -1 && inPageClear < inPageSpacer, "undocked clear before spacer");
        assert.ok(inPageSpacer < inPageActions, "undocked spacer before actions");

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
        assert.match(src, /chipVariants\(\{ active: true \}\)/);
        assert.match(src, /filterCountBadgeClass/);
        assert.match(src, /bg-muted lg:block/);
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

    it("undocked actions cluster sits after the flex-1 spacer", () => {
        const page = readFileSync(PAGE, "utf8");
        const toolbar = page.slice(page.indexOf('data-testid="jobs-toolbar"'), page.indexOf('data-testid="active-filter-row"'));
        const spacerIdx = toolbar.indexOf("min-w-0 flex-1");
        const actionsIdx = toolbar.indexOf('data-testid="jobs-toolbar-actions"');
        assert.ok(spacerIdx > -1 && actionsIdx > spacerIdx);
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
        assert.match(page, /chipVariants\(\{ active: filtersOpen \}\)/);
        assert.doesNotMatch(page, /chipVariants\(\{ active: filtersOpen \|\| activeCount/);
        assert.match(topbar, /chipVariants\(\{ active: docked\.filtersExpanded \}\)/);
        assert.doesNotMatch(topbar, /chipVariants\(\{ active: docked\.filtersExpanded \|\| docked\.filterCount/);
    });

    it("Rank by fit and compact Save search use quiet text, not chipVariants", () => {
        const page = readFileSync(PAGE, "utf8");
        const saved = readFileSync(SAVED_SEARCHES, "utf8");
        const rankBlock = page.slice(page.indexOf('data-testid="jobs-rank-by-fit"'), page.indexOf('data-testid="jobs-rank-by-fit"') + 350);
        assert.doesNotMatch(rankBlock, /chipVariants/);
        assert.match(rankBlock, /text-xs font-semibold text-foreground/);

        const saveTrigger = saved.slice(saved.indexOf('data-testid="save-search-trigger"'), saved.indexOf('data-testid="save-search-trigger"') + 450);
        assert.doesNotMatch(saveTrigger, /chipVariants/);
        assert.match(saveTrigger, /toolbarControlHeight/);
        assert.match(saveTrigger, /text-xs font-semibold text-foreground/);
    });

    it("shouldShowSearchAlertCapture call sites suppress while guest auth gate is visible", () => {
        const page = readFileSync(PAGE, "utf8");
        const authGatePattern = /authGateVisible:\s*showGuestEngageNudge\s*\|\|\s*showGuestSaveBanner/;
        const callSites = [...page.matchAll(/shouldShowSearchAlertCapture\(\{[\s\S]*?\}\)/g)];
        assert.ok(callSites.length >= 2, "expected at least two shouldShowSearchAlertCapture call sites");
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
