import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";
import { resumeDataToZipMarkdown } from "@/lib/resume/to-zip-markdown";
import { resumeDataToZipHtml } from "@/lib/resume/zip-html";
import { zipResumeHtmlFromData } from "@/lib/resume/export-zip-pdf";
import { resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { layoutResumeDocument, jsPdfMeasurer, DEFAULT_PAGE_METRICS } from "@/lib/resume/render-pdf";
import { jsPDF } from "jspdf";

const CSM_GOLDEN = readFileSync(
    path.join(process.cwd(), "tests/fixtures/vivek-csm-golden-resume.txt"),
    "utf8",
);
const PM_FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/vivek-pm-resume.txt"), "utf8");

describe("export-zip-pdf source contract", () => {
    it("FromData uses Chrome/Skia API then text jsPDF fallback — never html2canvas or parseResumeContent(md)", () => {
        const src = readFileSync(path.join(process.cwd(), "src/lib/resume/export-zip-pdf.ts"), "utf8");
        const start = src.indexOf("export async function exportZipResumePdfFromData");
        const next = src.indexOf("export async function exportZipResumePdf(", start + 1);
        const fromData = src.slice(start, next);
        assert.match(fromData, /resumeDataToParsedDocument\(data\)/);
        assert.match(fromData, /parsedResumeToZipHtml\(parsed\)/);
        assert.match(fromData, /fetchChromeTextPdf\(html\)|\/api\/resume\/pdf/);
        assert.match(fromData, /renderResumePdf\(parsed\)/);
        assert.doesNotMatch(fromData, /parseResumeContent\(/);
        assert.doesNotMatch(src, /import\s+.*html2canvas/);
        assert.doesNotMatch(src, /from ["']jspdf["']/);
        assert.doesNotMatch(src, /html2canvas\(/);
    });

    it("zip CSS uses Helvetica Neue and Letter @page margins", () => {
        const css = readFileSync(path.join(process.cwd(), "src/lib/resume/resume-zip.css.ts"), "utf8");
        assert.match(css, /Helvetica Neue/);
        assert.match(css, /@page/);
        assert.match(css, /0\.34in 0\.46in 0\.28in 0\.46in/);
        assert.match(css, /9\.2/);
    });
});

describe("resume zip PDF pipeline (no browser)", () => {
    it("builds HTML from ResumeData — not parseResumeContent(zip markdown)", () => {
        const data = resumeDataFromPlainText(CSM_GOLDEN);
        const md = resumeDataToZipMarkdown(data);
        const html = resumeDataToZipHtml(data);
        const fromHelper = zipResumeHtmlFromData(data);

        assert.match(md, /^# Vivek Narayanan/m);
        assert.match(html, /<!DOCTYPE html>/);
        assert.match(html, /resume-page/);
        assert.match(html, /Helvetica Neue/);
        assert.equal(fromHelper, html);
        assert.ok(!/Hands-on with/i.test(md));
        assert.match(html, /Richmond Hill, Ontario/);
    });

    it("jsPDF fallback from ResumeData keeps three competency lines (PM fixture)", () => {
        const data = resumeDataFromPlainText(PM_FIXTURE);
        const parsed = resumeDataToParsedDocument(data);
        const pdf = new jsPDF({ unit: "pt", format: [DEFAULT_PAGE_METRICS.pageWidth, DEFAULT_PAGE_METRICS.pageHeight] });
        const layout = layoutResumeDocument(parsed, jsPdfMeasurer(pdf));
        const texts = layout.pages.flatMap((p) => p.texts).map((t) => t.text);
        const joined = texts.join("\n");

        const competencyLabels = texts.filter((t) =>
            /^(Product|Delivery & Execution|Technical):/.test(t),
        );
        assert.ok(competencyLabels.length >= 3, `labels: ${competencyLabels.join(" | ")}`);
        assert.ok(!texts.some((t) => t === ":" || t.startsWith(": ")));
        assert.doesNotMatch(joined, /\*\*:/);
        assert.match(joined, /Richmond Hill/);
        assert.doesNotMatch(joined, /University \| Buffalo/);
        assert.match(joined, /INDEPENDENT PROJECTS/);
    });
});

describe("resume zip PDF pipeline (Playwright)", () => {
    it("golden CSM fixture prints to one Letter page from ResumeData HTML", async (t) => {
        let chromium: typeof import("playwright").chromium;
        try {
            ({ chromium } = await import("playwright"));
            await chromium.launch({ headless: true }).then((b) => b.close());
        } catch {
            t.skip("Playwright Chromium not installed — run: npx playwright install chromium");
            return;
        }

        const { htmlToChromePdf } = await import("@/lib/resume/chrome-print-pdf");
        const data = resumeDataFromPlainText(CSM_GOLDEN);
        const html = zipResumeHtmlFromData(data);
        const pdfBytes = await htmlToChromePdf(html);

        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
        assert.equal(pdf.numPages, 1, "golden CSM résumé must fit one Letter page");

        const { text } = await extractText(new Uint8Array(pdfBytes));
        const joined = text.join("\n");
        assert.ok(joined.includes("Richmond Hill"));
        assert.ok(/Customer Success/i.test(joined));
        assert.ok(/Delivery/i.test(joined));
        assert.ok(/Platform/i.test(joined));
        assert.ok(/MITx/i.test(joined));
        assert.ok(/University at Buffalo/i.test(joined) || /Buffalo/i.test(joined));
        assert.ok(!/University \| Buffalo/i.test(joined));
        assert.ok(!/Hands-on with/i.test(joined));
        assert.ok(!/\*\*:/.test(joined));
        assert.ok(joined.replace(/\s+/g, " ").trim().length >= 20, "must have extractable text");
    });
});
