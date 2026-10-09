import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractPDFTextInBrowser, PDF_NO_TEXT_MESSAGE } from "../../src/lib/local-ai/extract-in-browser";
import { ocrPageText, tidyOcrText, type OcrBlock, type OcrLine } from "../../src/lib/local-ai/ocr-pdf";
import { parseResumeLocally } from "../../src/lib/local-ai/parse-resume";

const PDF_DIR = path.join(process.cwd(), "tests/fixtures/resume-corpus/pdf");
const bytes = (name: string) => {
    const b = readFileSync(path.join(PDF_DIR, name));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("two-column PDF: a sidebar of contact, skills and school beside the jobs", () => {
    it("keeps the second job's title with its employer, and a wrapped degree whole", async () => {
        const { text, error } = await extractPDFTextInBrowser(bytes("accountant-ca.two-column.pdf"));
        assert.equal(error, undefined);
        const parsed = (await parseResumeLocally(text!, { skipDownload: true })).data.parsed;
        assert.deepEqual(
            parsed.experience.map((e) => [e.role, e.company]),
            [
                ["Senior Accountant", "Prairie Energy Partners"],
                ["Staff Accountant", "MNP LLP"],
            ],
        );
        // "Bachelor of Commerce," / "Accounting" / "University of Calgary" / "2016" down the sidebar.
        assert.deepEqual(
            parsed.education.map((e) => [e.degree, e.institution, e.year]),
            [["Bachelor of Commerce, Accounting", "University of Calgary", "2016"]],
        );
    });

    it("reads a title over 'Employer, Town · dates' as that job, not a line of the one above", async () => {
        const { text } = await extractPDFTextInBrowser(bytes("teacher-uk.two-column.pdf"));
        const parsed = (await parseResumeLocally(text!, { skipDownload: true })).data.parsed;
        assert.deepEqual(
            parsed.experience.map((e) => [e.role, e.company]),
            [
                ["Primary School Teacher", "Oakwood Primary School"],
                ["Teaching Assistant", "St. Anne's Church of England Primary"],
            ],
        );
    });
});

describe("scanned PDF: pictures of pages, read on the device", () => {
    it("outside a browser it still says the PDF has no text, and never throws", async () => {
        const result = await extractPDFTextInBrowser(bytes("warehouse-ca.scan.pdf"));
        assert.equal(result.error, PDF_NO_TEXT_MESSAGE);
    });

    const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
    /** One OCR line at `top` px: its words laid left to right, ~14 px per character. */
    const line = (top: number, words: string[], left = 150, height = 30): OcrLine => {
        let x = left;
        const laid = words.map((text) => {
            const w = { text, bbox: box(x, top, x + text.length * 14, top + height) };
            x += text.length * 14 + 14;
            return w;
        });
        return { bbox: box(left, top, x - 14, top + height), baseline: box(left, top + height - 6, x - 14, top + height - 6), rowAttributes: { rowHeight: height }, words: laid };
    };
    const page = (lines: OcrLine[]): OcrBlock[] => [{ paragraphs: [{ lines }] }];

    it("joins a bullet the page wrapped, turns a misread bullet into •, and keeps headings apart", () => {
        const text = ocrPageText(
            page([
                line(100, ["Experience"]),
                line(150, ["«", "Picked", "and", "packed", "two", "hundred", "orders", "an", "hour", "across", "the", "night", "and", "day"]),
                line(190, ["shifts", "without", "a", "single", "safety", "incident."]),
                line(230, ["©", "Trained", "six", "new", "starters."]),
                line(280, ["Skills"]),
            ]),
            2.5,
            2750,
        );
        assert.equal(
            text,
            [
                "Experience",
                "• Picked and packed two hundred orders an hour across the night and day shifts without a single safety incident.",
                "• Trained six new starters.",
                "Skills",
            ].join("\n"),
        );
    });

    it("tidies what the engine makes of bullets and Roman numerals", () => {
        assert.equal(tidyOcrText("« Led a crew\n+ Enhanced DBS check\nCertificate Ill in Electrotechnology"), "• Led a crew\n• Enhanced DBS check\nCertificate III in Electrotechnology");
    });
});
