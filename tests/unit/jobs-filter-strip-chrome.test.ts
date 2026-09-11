import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHIP = join(__dirname, "..", "..", "src", "components", "ui", "chip.tsx");
const FACET_BAR = join(__dirname, "..", "..", "src", "components", "jobs", "FacetBar.tsx");
const FILTER_CHIPS = join(__dirname, "..", "..", "src", "components", "jobs", "FilterChipsRow.tsx");
const PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "page.tsx");
const TOPBAR = join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx");

describe("jobs filter strip chrome guards", () => {
    it("chipVariants active uses brand blade, not fill or pills", () => {
        const src = readFileSync(CHIP, "utf8");
        const active = /active:\s*\{[\s\S]*?true:\s*"([^"]+)"/.exec(src);
        assert.ok(active, "chipVariants active variant must exist");
        const classes = active![1];
        assert.match(classes, /border-l-\[3px\]|border-l-/);
        assert.match(classes, /border-brand/);
        assert.match(classes, /text-brand/);
        assert.doesNotMatch(classes, /bg-brand/);
        assert.doesNotMatch(src, /rounded-full/);
    });

    it("FacetBar renders as a divided cluster instrument", () => {
        const src = readFileSync(FACET_BAR, "utf8");
        assert.match(src, /data-testid="facet-bar"/);
        assert.match(src, /divide-x/);
        assert.match(src, /border border-border bg-background/);
    });

    it("in-page leftover chips are active and grouped", () => {
        const src = readFileSync(PAGE, "utf8");
        const toolbar = src.slice(src.indexOf('data-testid="jobs-toolbar"'));
        assert.match(toolbar, /aria-label="Active filters"/);
        assert.match(toolbar, /chipVariants\(\{ active: true \}\)/);
    });

    it("jobs-toolbar band uses bg-background, not bg-muted fill", () => {
        const src = readFileSync(PAGE, "utf8");
        const at = src.indexOf('data-testid="jobs-toolbar"');
        const band = src.slice(at, at + 400);
        assert.match(band, /bg-background/);
        assert.doesNotMatch(band, /showJobsToolbarRow[\s\S]{0,120}bg-muted/);
    });

    it("TopBar docked leftover chips use active chipVariants", () => {
        const src = readFileSync(TOPBAR, "utf8");
        const dockedChips = src.slice(src.indexOf('data-testid="topbar-docked-chip"'));
        assert.match(dockedChips, /chipVariants\(\{ active: true \}\)/);
    });

    it("FilterChipsRow defers colour to chipVariants and clusters like FacetBar", () => {
        const src = readFileSync(FILTER_CHIPS, "utf8");
        assert.doesNotMatch(src, /border-foreground/);
        assert.doesNotMatch(src, /!active && "border-foreground/);
        assert.doesNotMatch(src, /active && "border-brand bg-muted/);
        assert.match(src, /chipVariants\(\{ active \}\)/);
        assert.match(src, /divide-x divide-border/);
    });

    it("changed sources do not mention JobDetailHandoff", () => {
        for (const file of [CHIP, FACET_BAR, FILTER_CHIPS, PAGE, TOPBAR]) {
            const src = readFileSync(file, "utf8");
            assert.doesNotMatch(src, /JobDetailHandoff/);
        }
    });
});
