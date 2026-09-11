import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHIP = join(__dirname, "..", "..", "src", "components", "ui", "chip.tsx");
const FILTER_CHIPS_ROW = join(__dirname, "..", "..", "src", "components", "jobs", "FilterChipsRow.tsx");
const FACET_BAR = join(__dirname, "..", "..", "src", "components", "jobs", "FacetBar.tsx");
const PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "page.tsx");
const TOPBAR = join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx");
const GLOBALS = join(__dirname, "..", "..", "src", "app", "globals.css");

const CHANGED = [CHIP, FILTER_CHIPS_ROW, FACET_BAR, PAGE, TOPBAR, GLOBALS];

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

    it("changed files do not touch JobDetail handoff or list-detail motion", () => {
        for (const file of CHANGED) {
            const src = readFileSync(file, "utf8");
            assert.doesNotMatch(src, /JobDetailHandoff/);
            assert.doesNotMatch(src, /clip-path/);
            assert.doesNotMatch(src, /list-detail overlap/i);
        }
    });
});
