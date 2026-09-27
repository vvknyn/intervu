/**
 * Local proof for packs-home: HTML → Chrome/Skia text PDF + pdftotext + PNG.
 * Writes: .velai-packs-home-local/s-resume-text-pdf.{pdf,txt,png,meta.json}
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { linuxChromiumVisualQaLaunchOptions } from "./design/linux-chromium-visual-qa.cjs";
import { extractText, getDocumentProxy } from "unpdf";
import { htmlToChromePdf } from "../src/lib/resume/chrome-print-pdf";
import { resumeDataFromPlainText } from "../src/lib/resume/structure-resume-text";
import { resumeDataToZipHtml } from "../src/lib/resume/zip-html";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".velai-packs-home-local");
const FIXTURE = readFileSync(path.join(ROOT, "tests/fixtures/vivek-csm-golden-resume.txt"), "utf8");

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });
    const data = resumeDataFromPlainText(FIXTURE);
    const html = resumeDataToZipHtml(data);

    const pdfPath = path.join(OUT_DIR, "s-resume-text-pdf.pdf");
    const txtPath = path.join(OUT_DIR, "s-resume-text-pdf.txt");
    const pngPath = path.join(OUT_DIR, "s-resume-text-pdf.png");
    const metaPath = path.join(OUT_DIR, "s-resume-text-pdf.meta.json");

    let pdfBytes: Buffer;
    let engine = "playwright-chromium";
    try {
        pdfBytes = await htmlToChromePdf(html);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeFileSync(
            metaPath,
            JSON.stringify(
                {
                    ok: false,
                    blocker: "Chromium/Playwright print-to-pdf failed (OS may block headless).",
                    detail: message,
                    hint: "npx playwright install chromium",
                },
                null,
                2,
            ),
        );
        throw err;
    }

    writeFileSync(pdfPath, pdfBytes);

    const proxy = await getDocumentProxy(new Uint8Array(pdfBytes));
    const { text } = await extractText(new Uint8Array(pdfBytes));
    const joined = text.join("\n");
    const extractable = joined.replace(/\s+/g, " ").trim();

    let pdftotext = "";
    try {
        pdftotext = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
        writeFileSync(txtPath, pdftotext, "utf8");
    } catch (err) {
        writeFileSync(txtPath, joined, "utf8");
        pdftotext = joined;
        console.warn("pdftotext unavailable; wrote unpdf extract instead", err);
    }

    // PNG preview of the HTML page (same document printed to PDF)
    const browser = await chromium.launch(linuxChromiumVisualQaLaunchOptions({ headless: true }));
    try {
        const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
        await page.setContent(html, { waitUntil: "networkidle" });
        await page.screenshot({ path: pngPath, fullPage: false, type: "png" });
    } finally {
        await browser.close();
    }

    const producer = (() => {
        const head = pdfBytes.subarray(0, Math.min(pdfBytes.length, 64_000)).toString("latin1");
        const m = head.match(/\/Producer\s*\(([^)]+)\)/);
        return m?.[1] ?? null;
    })();

    const meta = {
        ok: extractable.length >= 20 && proxy.numPages === 1,
        engine,
        pages: proxy.numPages,
        extractableChars: extractable.length,
        producer,
        pdf: "s-resume-text-pdf.pdf",
        txt: "s-resume-text-pdf.txt",
        png: "s-resume-text-pdf.png",
        pdftotextSnippet: pdftotext.slice(0, 500),
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    console.log(JSON.stringify(meta, null, 2));
    if (!meta.ok) {
        throw new Error(`Proof failed: pages=${meta.pages} extractableChars=${meta.extractableChars}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
