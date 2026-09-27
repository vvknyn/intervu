import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FOR_YOU = join(__dirname, "../../src/components/jobs/for-you");
const JOBS = join(__dirname, "../../src/components/jobs");
const RESUME = join(__dirname, "../../src/components/resume-builder");
const COMPANY = join(__dirname, "../../src/components/company");

describe("for-you mobile chrome", () => {
    it("ForYouHome keeps pack navigation and skip controls at phone-friendly tap targets", () => {
        const src = readFileSync(join(FOR_YOU, "ForYouHome.tsx"), "utf8");
        assert.doesNotMatch(src, /for-you-preferences/, "preference chips are Search-only");
        assert.match(src, /data-testid="for-you-skip"/);
        assert.match(src, /data-testid="for-you-next"/);
        assert.match(src, /data-testid="for-you-previous"/);
        assert.match(src, /h-11 min-h-11[\s\S]*data-testid="for-you-skip"/);
    });

    it("LocalCustomizePanel dialog and footer actions are phone-friendly", () => {
        const src = readFileSync(join(JOBS, "LocalCustomizePanel.tsx"), "utf8");
        assert.match(src, /max-h-\[85dvh\]/);
        const copyBlock =
            src.match(/<Button[\s\S]*?data-testid="local-customize-copy"[\s\S]*?<\/Button>/)?.[0] ?? "";
        const pdfBlock =
            src.match(/<Button[\s\S]*?data-testid="local-customize-pdf"[\s\S]*?<\/Button>/)?.[0] ?? "";
        assert.match(copyBlock, /min-h-11/);
        assert.match(pdfBlock, /min-h-11/);
        assert.ok(copyBlock.length > 0, "Copy must be a Button");
        assert.ok(pdfBlock.length > 0, "Download PDF must be a Button");
    });

    it("ResumeImportModal shrinks on short phones", () => {
        const src = readFileSync(join(RESUME, "ResumeImportModal.tsx"), "utf8");
        assert.match(src, /max-h-\[90dvh\]/);
        assert.match(src, /grid-cols-1[\s\S]*sm:grid-cols-2/);
        assert.doesNotMatch(src, /ScrollArea className="h-\[400px\]"/);
        assert.match(src, /max-h-\[min\(50dvh,400px\)\]/);
    });

    it("CompanyRoleSearch title clamps instead of overflowing on narrow viewports", () => {
        const src = readFileSync(join(COMPANY, "CompanyRoleSearch.tsx"), "utf8");
        assert.match(src, /min-w-0 text-base font-semibold/);
        assert.match(src, /line-clamp-2/, "title must clamp rather than overflow unbounded");
    });

    it("ApplyIntentDialog uses dvh for mobile viewport height", () => {
        const src = readFileSync(join(JOBS, "ApplyIntentDialog.tsx"), "utf8");
        assert.match(src, /max-h-\[85dvh\]/);
    });

    it("ApplyIntentDialog uses p-0 shell with explicit px-6 zone padding", () => {
        const src = readFileSync(join(JOBS, "ApplyIntentDialog.tsx"), "utf8");
        assert.match(
            src,
            /DialogContent className="[^"]*\bp-0\b[^"]*"/,
            "DialogContent must override primitive p-6 with p-0",
        );
        assert.match(src, /shrink-0 px-6 pt-6 pr-12/, "header zone must carry px-6");
        assert.match(
            src,
            /overflow-y-auto px-6/,
            "middle scroller must carry px-6",
        );
        assert.match(
            src,
            /border-t border-border px-6/,
            "footer zone must carry px-6",
        );
    });

    it("ForYouDeck exposes swipe navigate + touch-pan-y for phone deck", () => {
        const src = readFileSync(join(FOR_YOU, "ForYouDeck.tsx"), "utf8");
        assert.match(src, /onSwipeNavigate/);
        assert.match(src, /touch-pan-y/);
        assert.match(src, /resolveDeckSwipe/);
        assert.match(src, /data-testid="for-you-deck"/);
    });

    it("CategoryHubGrid hub is touch-first with safe-area and full-width CTAs", () => {
        const src = readFileSync(join(JOBS, "CategoryHubGrid.tsx"), "utf8");
        assert.match(src, /data-testid="job-packs-hub"/);
        assert.match(src, /safe-area-inset-bottom/);
        assert.match(src, /touch-manipulation/);
        assert.match(src, /min-h-11 w-full/);
        assert.match(src, /min-h-\[5\.75rem\]/);
    });

    it("ApplyReturnPrompt is Yes / Not yet / Skip with thumb-sized targets", () => {
        const src = readFileSync(join(JOBS, "ApplyReturnPrompt.tsx"), "utf8");
        assert.match(src, />\s*Yes\s*</);
        assert.match(src, />\s*Not yet\s*</);
        assert.match(src, /data-testid="apply-return-skip"/);
        assert.match(src, /min-h-11/);
        assert.match(src, /safe-area-inset-bottom/);
        assert.doesNotMatch(src, />\s*I applied\s*</);
    });
});
