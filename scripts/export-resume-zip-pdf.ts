/**
 * Generate golden CSM zip résumé markdown + Playwright Letter PDF for visual verification.
 *
 * Run: npx tsx scripts/export-resume-zip-pdf.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { htmlToChromePdf } from "../src/lib/resume/chrome-print-pdf";
import { resumeDataFromPlainText } from "../src/lib/resume/structure-resume-text";
import { resumeDataToZipMarkdown } from "../src/lib/resume/to-zip-markdown";
import { resumeDataToZipHtml } from "../src/lib/resume/zip-html";

const FIXTURE = readFileSync(
    path.join(process.cwd(), "tests/fixtures/vivek-csm-golden-resume.txt"),
    "utf8",
);

async function main() {
    const data = resumeDataFromPlainText(FIXTURE);
    const md = resumeDataToZipMarkdown(data);
    const html = resumeDataToZipHtml(data);

    const tmpMd = "/tmp/resume-csm-golden.md";
    writeFileSync(tmpMd, md, "utf8");
    console.log(`Wrote markdown: ${tmpMd}`);

    const outPdf = path.join(process.cwd(), "test-resume-csm-golden.pdf");
    const pdfBytes = await htmlToChromePdf(html);
    writeFileSync(outPdf, pdfBytes);
    console.log(`Wrote PDF: ${outPdf}`);

    const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
    const pageCount = pdf.numPages;
    const { text } = await extractText(new Uint8Array(pdfBytes));
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
    if (/\*\*:/.test(joined) || /^:\s/m.test(joined)) {
        console.error("Found mangled competency markers (**: or orphan :)");
        process.exitCode = 1;
    }
    if (/University \| Buffalo/i.test(joined)) {
        console.error("Education split University | Buffalo");
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
