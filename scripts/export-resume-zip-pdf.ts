/**
 * Generate golden CSM zip résumé markdown + Playwright Letter PDF for visual verification.
 *
 * Run: npx tsx scripts/export-resume-zip-pdf.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { extractText, getDocumentProxy } from "unpdf";
import { structureResumeText } from "../src/lib/resume/structure-resume-text";
import { resumeDataToZipMarkdown } from "../src/lib/resume/to-zip-markdown";
import { zipMarkdownToHtml } from "../src/lib/resume/zip-html";
import type { ResumeData } from "../src/types/resume";

const FIXTURE = readFileSync(
    path.join(process.cwd(), "tests/fixtures/vivek-csm-golden-resume.txt"),
    "utf8",
);

function goldenResumeData(): ResumeData {
    const draft = structureResumeText(FIXTURE);
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

async function main() {
    const data = goldenResumeData();
    const md = resumeDataToZipMarkdown(data);
    const html = zipMarkdownToHtml(md);

    const tmpMd = "/tmp/resume-csm-golden.md";
    writeFileSync(tmpMd, md, "utf8");
    console.log(`Wrote markdown: ${tmpMd}`);

    const outPdf = path.join(process.cwd(), "test-resume-csm-golden.pdf");
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });
        await page.pdf({
            path: outPdf,
            format: "Letter",
            printBackground: true,
            margin: { top: "0", right: "0", bottom: "0", left: "0" },
        });
        console.log(`Wrote PDF: ${outPdf}`);
    } finally {
        await browser.close();
    }

    const bytes = readFileSync(outPdf);
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const pageCount = pdf.numPages;
    const { text } = await extractText(new Uint8Array(bytes));
    const joined = text.join("\n");

    console.log(`Page count: ${pageCount}`);

    if (pageCount !== 1) {
        console.error(`Expected 1 page, got ${pageCount}`);
        process.exitCode = 1;
    }
    if (!joined.includes("Richmond Hill")) {
        console.error("Missing Richmond Hill in extracted text");
        process.exitCode = 1;
    }
    if (!/Customer Success/i.test(joined)) {
        console.error("Missing Customer Success in extracted text");
        process.exitCode = 1;
    }
    if (!/Delivery/i.test(joined)) {
        console.error("Missing Delivery in extracted text");
        process.exitCode = 1;
    }
    if (!/Platform/i.test(joined)) {
        console.error("Missing Platforms in extracted text");
        process.exitCode = 1;
    }
    if (!/MITx/i.test(joined)) {
        console.error("Missing MITx in extracted text");
        process.exitCode = 1;
    }
    if (!/Buffalo/i.test(joined)) {
        console.error("Missing Buffalo in extracted text");
        process.exitCode = 1;
    }
    if (/Hands-on with/i.test(joined)) {
        console.error("Found banned Hands-on with phrase");
        process.exitCode = 1;
    }
    if (/^Skills:/m.test(joined)) {
        console.error("Found Skills: dump wrapper in extracted text");
        process.exitCode = 1;
    }

    if (process.exitCode === 1) {
        throw new Error("Golden PDF verification failed");
    }
    console.log("Golden PDF verification passed (1 page, expected markers present).");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
