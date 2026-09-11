import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveJobDetailHandoff } from "../../src/lib/jobs/job-detail-handoff";

describe("resolveJobDetailHandoff", () => {
    it("returns none when nextId is absent", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "a",
                nextId: null,
                previousExplicit: true,
                nextExplicit: true,
                surface: "pane",
                reducedMotion: false,
            }),
            "none",
        );
    });

    it("returns none when selection is not explicit (ambient preview)", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: null,
                nextId: "job-1",
                previousExplicit: false,
                nextExplicit: false,
                surface: "pane",
                reducedMotion: false,
            }),
            "none",
        );
    });

    it("returns none when identity and explicit are unchanged", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "job-1",
                nextId: "job-1",
                previousExplicit: true,
                nextExplicit: true,
                surface: "pane",
                reducedMotion: false,
            }),
            "none",
        );
    });

    it("returns none when desktop pane already shows ambient job and only explicit opens", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "job-1",
                nextId: "job-1",
                previousExplicit: false,
                nextExplicit: true,
                surface: "pane",
                reducedMotion: false,
            }),
            "none",
        );
    });

    it("plays clip when mobile sheet appears for the same job (ambient → explicit)", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "job-1",
                nextId: "job-1",
                previousExplicit: false,
                nextExplicit: true,
                surface: "sheet",
                reducedMotion: false,
            }),
            "clip",
        );
    });

    it("plays clip when identity changes with an explicit selection", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "job-1",
                nextId: "job-2",
                previousExplicit: true,
                nextExplicit: true,
                surface: "pane",
                reducedMotion: false,
            }),
            "clip",
        );
    });

    it("plays clip on first explicit open from no prior id", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: null,
                nextId: "job-1",
                previousExplicit: false,
                nextExplicit: true,
                surface: "sheet",
                reducedMotion: false,
            }),
            "clip",
        );
    });

    it("returns fade instead of clip when reducedMotion is true", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "job-1",
                nextId: "job-2",
                previousExplicit: true,
                nextExplicit: true,
                surface: "pane",
                reducedMotion: true,
            }),
            "fade",
        );
    });

    it("treats reducedMotion null like false (clip)", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "job-1",
                nextId: "job-2",
                previousExplicit: true,
                nextExplicit: true,
                surface: "sheet",
                reducedMotion: null,
            }),
            "clip",
        );
    });

    it("returns fade for sheet explicit-open when reducedMotion is true", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "job-1",
                nextId: "job-1",
                previousExplicit: false,
                nextExplicit: true,
                surface: "sheet",
                reducedMotion: true,
            }),
            "fade",
        );
    });

    it("returns none when an explicit selection closes", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "job-1",
                nextId: "job-1",
                previousExplicit: true,
                nextExplicit: false,
                surface: "pane",
                reducedMotion: false,
            }),
            "none",
        );
    });

    it("returns none when ambient preview identity changes (filter/search refresh)", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "job-1",
                nextId: "job-2",
                previousExplicit: false,
                nextExplicit: false,
                surface: "pane",
                reducedMotion: false,
            }),
            "none",
        );
    });

    it("plays clip on desktop when explicit identity changes from ambient to another job", () => {
        assert.equal(
            resolveJobDetailHandoff({
                previousId: "job-1",
                nextId: "job-2",
                previousExplicit: false,
                nextExplicit: true,
                surface: "pane",
                reducedMotion: false,
            }),
            "clip",
        );
    });
});

describe("jobs page integrates JobDetailHandoff", () => {
    const pageSource = readFileSync("src/app/jobs/page.tsx", "utf8");

    it("imports JobDetailHandoff", () => {
        assert.match(pageSource, /import\s+\{\s*JobDetailHandoff\s*\}\s+from\s+"@\/components\/jobs\/JobDetailHandoff"/);
    });

    it("wraps detail-pane inner content with JobDetailHandoff", () => {
        const paneIdx = pageSource.indexOf('data-testid="detail-pane"');
        assert.ok(paneIdx >= 0, "detail-pane test id missing");
        const paneSlice = pageSource.slice(paneIdx, paneIdx + 1200);
        assert.match(paneSlice, /<JobDetailHandoff[\s\S]*surface="pane"/);
    });

    it("wraps mobile-detail-scroller inner content with JobDetailHandoff", () => {
        const scrollerIdx = pageSource.indexOf('data-testid="mobile-detail-scroller"');
        assert.ok(scrollerIdx >= 0, "mobile-detail-scroller test id missing");
        const scrollerSlice = pageSource.slice(scrollerIdx, scrollerIdx + 2200);
        assert.match(scrollerSlice, /<JobDetailHandoff[\s\S]*surface="sheet"/);
    });

    it("keys handoff explicit off searchParams job param, not queryDraft", () => {
        assert.match(pageSource, /detailExplicit\s*=\s*Boolean\(searchParams\.get\("job"\)\)/);
        assert.doesNotMatch(
            pageSource.slice(pageSource.indexOf("detailExplicit"), pageSource.indexOf("detailExplicit") + 200),
            /queryDraft/,
        );
        assert.match(
            pageSource,
            /identity=\{detailJob\?\.id\s*\?\?\s*null\}[\s\S]*explicit=\{detailExplicit\}/,
        );
    });
});
