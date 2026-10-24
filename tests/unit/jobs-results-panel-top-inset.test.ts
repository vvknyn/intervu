import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = readFileSync(join(__dirname, "../../src/app/jobs/JobsContent.tsx"), "utf8");

describe("results panel top inset", () => {
    it("the bordered list panel owns the top padding, so whichever row renders first is inset", () => {
        const panel = PAGE.match(/className="([^"]*rounded-panel border border-border bg-surface[^"]*xl:min-w-0)"/);
        assert.ok(panel, "list panel found");
        assert.match(panel[1], /(^| )pt-3( |$)/);
        const firstRow = PAGE.indexOf('data-testid="resume-read-strip"');
        assert.ok(PAGE.indexOf(panel[0]) < firstRow, "résumé strip renders inside the padded panel");
    });
    it("the count line (first row when anonymous) adds no top padding of its own", () => {
        const line = PAGE.match(/className="([^"]*)">\s*<div className="flex flex-wrap items-center gap-2">\s*<span\s+data-testid="result-line"/);
        assert.ok(line, "count line container found");
        assert.doesNotMatch(line[1], /(^| )(py-\d|pt-\d)/);
    });
});

describe("docked search pill: inline button inset", () => {
    const BAR = readFileSync(join(__dirname, "../../src/components/layout/TopBar.tsx"), "utf8");
    it("insets the button evenly inside the bordered pill and gives it the pill radius", () => {
        const form = BAR.match(/data-testid="topbar-docked-search"[\s\S]*?className="([^"]*)"/);
        assert.ok(form);
        assert.match(form[1], /rounded-pill/);
        assert.match(form[1], /(^| )p-0\.5( |$)/);
        const btn = BAR.match(/data-testid="search-submit"\s+className="([^"]*)"/);
        assert.ok(btn);
        assert.match(btn[1], /rounded-pill/);
    });
});
