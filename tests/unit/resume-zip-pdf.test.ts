import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { structureResumeText } from "@/lib/resume/structure-resume-text";
import { resumeDataToZipMarkdown } from "@/lib/resume/to-zip-markdown";
import { zipMarkdownToHtml } from "@/lib/resume/zip-html";
import { zipResumeHtmlFromData } from "@/lib/resume/export-zip-pdf";
import type { ResumeData } from "@/types/resume";

const CSM_GOLDEN = readFileSync(
    path.join(process.cwd(), "tests/fixtures/vivek-csm-golden-resume.txt"),
    "utf8",
);

function goldenResumeData(): ResumeData {
    const draft = structureResumeText(CSM_GOLDEN);
    return {
        profile: {
            name: draft.profile.name ?? "",
            profession: draft.profile.profession ?? "",
            yearsOfExperience: draft.profile.yearsOfExperience ?? 0,
            location: draft.profile.location ?? "",
            email: draft.profile.email ?? "",
            phone: draft.profile.phone ?? "",
            linkedin: draft.profile.linkedin,
            website: draft.profile.website,
        },
        experience: draft.experience.map((e, i) => ({ ...e, id: `exp-${i}` })),
        projects: draft.projects.map((e, i) => ({ ...e, id: `proj-${i}` })),
        competencies: draft.competencies,
        education: draft.education.map((e, i) => ({ ...e, id: `edu-${i}` })),
        generatedSummary: draft.generatedSummary,
    };
}

describe("resume zip PDF pipeline (no browser)", () => {
    it("builds markdown and HTML from golden ResumeData", () => {
        const data = goldenResumeData();
        const md = resumeDataToZipMarkdown(data);
        const html = zipMarkdownToHtml(md);
        const fromHelper = zipResumeHtmlFromData(data);

        assert.match(md, /^# Vivek Narayanan/m);
        assert.match(html, /<!DOCTYPE html>/);
        assert.match(html, /resume-page/);
        assert.equal(fromHelper, html);
        assert.ok(!/Hands-on with/i.test(md));
    });
});

describe("resume zip PDF pipeline (Playwright)", () => {
    it("golden fixture prints to one Letter page when Playwright is available", async (t) => {
        let chromium: typeof import("playwright").chromium;
        try {
            ({ chromium } = await import("playwright"));
            await chromium.launch({ headless: true }).then((b) => b.close());
        } catch {
            t.skip("Playwright Chromium not installed — run: npx playwright install chromium");
            return;
        }

        const data = goldenResumeData();
        const html = zipResumeHtmlFromData(data);
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: "networkidle" });
            const pdfBytes = await page.pdf({
                format: "Letter",
                printBackground: true,
                margin: { top: "0", right: "0", bottom: "0", left: "0" },
            });

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
            assert.ok(/Buffalo/i.test(joined));
            assert.ok(!/Hands-on with/i.test(joined));
        } finally {
            await browser.close();
        }
    });
});
