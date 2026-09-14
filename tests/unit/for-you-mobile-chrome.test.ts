import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FOR_YOU = join(__dirname, "../../src/components/jobs/for-you");
const JOBS = join(__dirname, "../../src/components/jobs");
const RESUME = join(__dirname, "../../src/components/resume-builder");
const COMPANY = join(__dirname, "../../src/components/company");
const APP = join(__dirname, "../../src/app/jobs/page.tsx");

describe("for-you mobile chrome", () => {
    it("ForYouToggle tabs meet 44px touch target", () => {
        const src = readFileSync(join(FOR_YOU, "ForYouToggle.tsx"), "utf8");
        assert.match(src, /inline-flex min-h-11 items-center px-4 text-xs font-semibold/);
    });

    it("PreferenceChipStrip keeps wrap and reachable Edit link", () => {
        const src = readFileSync(join(FOR_YOU, "PreferenceChipStrip.tsx"), "utf8");
        assert.match(src, /flex flex-wrap/);
        assert.match(src, /inline-flex min-h-11 items-center text-xs font-semibold/);
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

    it("CompanyRoleSearch title truncates on narrow viewports", () => {
        const src = readFileSync(join(COMPANY, "CompanyRoleSearch.tsx"), "utf8");
        assert.match(src, /min-w-0 truncate text-base font-semibold/);
    });

    it("ApplyIntentDialog uses dvh for mobile viewport height", () => {
        const src = readFileSync(join(JOBS, "ApplyIntentDialog.tsx"), "utf8");
        assert.match(src, /max-h-\[85dvh\]/);
    });

    it("jobs page wires ForYouHome replace-resume props", () => {
        const src = readFileSync(APP, "utf8");
        assert.match(src, /onReplaceResume=\{handleUploadClick\}/);
        assert.match(src, /hasUsableResume=\{hasUsableResume\}/);
    });
});
