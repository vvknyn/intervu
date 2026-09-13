/**
 * Verify the Download path: ResumeData → parsed document → zip HTML → Chromium/Skia PDF.
 * Does not send markdown through parseResumeContent.
 *
 * Run: npx tsx scripts/verify-resume-from-data.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { extractText, getDocumentProxy } from "unpdf";
import { resumeDataToParsedDocument } from "../src/lib/resume/parse-resume-content";
import { resumeDataFromPlainText } from "../src/lib/resume/structure-resume-text";
import { resumeDataToZipMarkdown } from "../src/lib/resume/to-zip-markdown";
import { buildZipResumeDocument, parsedResumeToZipHtml } from "../src/lib/resume/zip-html";

const FIXTURE = readFileSync(
    path.join(process.cwd(), "tests/fixtures/vivek-csm-golden-resume.txt"),
    "utf8",
);

async function main() {
    const data = resumeDataFromPlainText(FIXTURE);
    const parsed = resumeDataToParsedDocument(data);
    const html = buildZipResumeDocument(parsedResumeToZipHtml(parsed));
    const md = resumeDataToZipMarkdown(data);

    writeFileSync("/tmp/resume-csm-golden.md", md, "utf8");
    console.log("Wrote inspectable markdown: /tmp/resume-csm-golden.md");

    const competencies = parsed.sections
        .find((s) => s.heading === "CORE COMPETENCIES")
        ?.blocks.filter((b) => b.kind === "competency");
    if (!competencies || competencies.length !== 3) {
        throw new Error(`expected 3 competency lines, got ${competencies?.length ?? 0}`);
    }
    for (const block of competencies) {
        if (block.kind !== "competency" || block.category.length < 2 || !block.items.includes(",")) {
            throw new Error(`mangled competency: ${JSON.stringify(block)}`);
        }
    }
    if (!parsed.contactLine?.includes("Richmond Hill")) {
        throw new Error(`contact missing Richmond Hill: ${parsed.contactLine}`);
    }

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
    const header = bytes.subarray(0, Math.min(bytes.length, 2048)).toString("latin1");
    if (!/Skia/i.test(header) && !/Chromium/i.test(header)) {
        throw new Error(`expected Chromium/Skia producer, header snippet: ${header.slice(0, 200)}`);
    }

    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const pageCount = pdf.numPages;
    const { text } = await extractText(new Uint8Array(bytes));
    const joined = text.join("\n");

    console.log(`Producer: Chromium/Skia; pages: ${pageCount}`);

    const failures: string[] = [];
    if (pageCount !== 1) failures.push(`expected 1 page, got ${pageCount}`);
    if (!joined.includes("Richmond Hill")) failures.push("missing Richmond Hill");
    if (!/Customer Success/i.test(joined)) failures.push("missing Customer Success");
    if (!/Delivery/i.test(joined)) failures.push("missing Delivery");
    if (!/Platform/i.test(joined)) failures.push("missing Platforms");
    if (/\*\*:/.test(joined) || /^:\s/m.test(joined)) failures.push("mangled competency markers");
    if (/University \| Buffalo/i.test(joined)) failures.push("University | Buffalo split");
    if (/Hands-on with/i.test(joined)) failures.push("Hands-on with spam");

    if (failures.length > 0) {
        throw new Error(`verify-resume-from-data failed:\n${failures.join("\n")}`);
    }
    console.log("verify-resume-from-data passed (1 page, Skia, 3 competency lines intact).");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
