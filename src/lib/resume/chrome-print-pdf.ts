/**
 * HTML → Chromium/Skia print-to-PDF (real selectable text).
 *
 * Mirrors Job Apply's headless Chrome `--print-to-pdf` path: semantic HTML +
 * inline CSS → Playwright Chromium `page.pdf`. Node-only — never import from
 * client bundles. Browser downloads call `/api/resume/pdf`, which uses this.
 *
 * Product: velai.app (never intervu.cc in user-facing copy).
 */
import { chromium, type Browser } from "playwright";

export interface ChromePrintPdfOptions {
    /** Override Playwright launch; useful for tests. */
    browser?: Browser;
}

/**
 * Print a self-contained résumé HTML document to US Letter PDF bytes.
 * Prefer CSS `@page` / `.resume-page` padding for margins (match RESUME_ZIP_CSS).
 */
export async function htmlToChromePdf(
    html: string,
    options: ChromePrintPdfOptions = {},
): Promise<Buffer> {
    if (!html.includes("resume-page")) {
        throw new Error("chrome-print-pdf: HTML must include .resume-page");
    }

    const ownBrowser = !options.browser;
    const browser = options.browser ?? (await chromium.launch({ headless: true }));
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });
        const pdf = await page.pdf({
            format: "Letter",
            printBackground: true,
            preferCSSPageSize: true,
            // Margins come from RESUME_ZIP_CSS (@page / .resume-page padding).
            margin: { top: "0", right: "0", bottom: "0", left: "0" },
        });
        return Buffer.from(pdf);
    } finally {
        if (ownBrowser) await browser.close();
    }
}
