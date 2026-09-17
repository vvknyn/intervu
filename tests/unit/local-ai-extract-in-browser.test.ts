import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { extractPDFTextInBrowser, extractDocxTextInBrowser } from "../../src/lib/local-ai/extract-in-browser";

/**
 * Item 1 (browser-side extraction): these exercise the real browser-side
 * extractors end to end (real unpdf/mammoth parse of a real byte buffer),
 * not a reimplementation of their logic — a fixture that only mirrors the
 * source can't falsify it.
 */

function toArrayBuffer(buf: Buffer): ArrayBuffer {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Same minimal single-page PDF construction as tests/unit/pdf-extraction.test.ts,
 *  returning raw bytes (extractPDFTextInBrowser takes an ArrayBuffer, not base64). */
function buildTestPdf(textLines: string[]): ArrayBuffer {
    const textOps = textLines.map((line, i) => `${i === 0 ? "" : `0 -18 Td\n`}(${line}) Tj`).join("\n");
    const streamContent = `BT\n/F1 11 Tf\n72 720 Td\n${textOps}\nET`;
    const streamLength = Buffer.byteLength(streamContent);

    const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${streamLength} >>
stream
${streamContent}
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000278 00000 n
0000000528 00000 n
trailer << /Size 6 /Root 1 0 R >>
startxref
610
%%EOF`;
    return toArrayBuffer(Buffer.from(pdf));
}

/** Minimal valid (uncompressed/STORED) ZIP writer, using only Node builtins
 *  (Buffer + zlib.crc32) — no zip dependency exists in this repo, and a
 *  DOCX is just a ZIP of these three parts. */
function buildZip(entries: { name: string; content: string }[]): ArrayBuffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const { name, content } of entries) {
        const nameBuf = Buffer.from(name, "utf8");
        const dataBuf = Buffer.from(content, "utf8");
        const crc = crc32(dataBuf) >>> 0;

        const local = Buffer.alloc(30 + nameBuf.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0, 6); // flags
        local.writeUInt16LE(0, 8); // method: stored
        local.writeUInt16LE(0, 10); // mod time
        local.writeUInt16LE(0, 12); // mod date
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(dataBuf.length, 18); // compressed size
        local.writeUInt32LE(dataBuf.length, 22); // uncompressed size
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28); // extra field length
        nameBuf.copy(local, 30);
        localParts.push(local, dataBuf);

        const central = Buffer.alloc(46 + nameBuf.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4); // version made by
        central.writeUInt16LE(20, 6); // version needed
        central.writeUInt16LE(0, 8); // flags
        central.writeUInt16LE(0, 10); // method
        central.writeUInt16LE(0, 12); // mod time
        central.writeUInt16LE(0, 14); // mod date
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(dataBuf.length, 20);
        central.writeUInt32LE(dataBuf.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30); // extra length
        central.writeUInt16LE(0, 32); // comment length
        central.writeUInt16LE(0, 34); // disk number start
        central.writeUInt16LE(0, 36); // internal attrs
        central.writeUInt32LE(0, 38); // external attrs
        central.writeUInt32LE(offset, 42); // local header offset
        nameBuf.copy(central, 46);
        centralParts.push(central);

        offset += local.length + dataBuf.length;
    }

    const centralDir = Buffer.concat(centralParts);
    const centralDirOffset = offset;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20);

    return toArrayBuffer(Buffer.concat([...localParts, centralDir, eocd]));
}

const CONTENT_TYPES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    "</Types>";

const PACKAGE_RELS_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

/** Minimal valid .docx: [Content_Types].xml + _rels/.rels + word/document.xml,
 *  one <w:p> per paragraph. */
function buildTestDocx(paragraphs: string[]): ArrayBuffer {
    const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
    const documentXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${body}</w:body></w:document>`;

    return buildZip([
        { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
        { name: "_rels/.rels", content: PACKAGE_RELS_XML },
        { name: "word/document.xml", content: documentXml },
    ]);
}

describe("extractPDFTextInBrowser", () => {
    it("extracts text from a simple PDF", async () => {
        const buffer = buildTestPdf([
            "Jane Smith - Senior Product Manager",
            "8 years of experience in SaaS product management",
        ]);
        const result = await extractPDFTextInBrowser(buffer);
        assert.ok(!result.error, `should not error: ${result.error}`);
        assert.ok(result.text?.includes("Jane Smith"));
        assert.ok(result.text?.includes("Product Manager"));
    });

    it("rejects non-PDF data with the same header-check message the server action uses", async () => {
        const buffer = toArrayBuffer(Buffer.from("This is not a PDF file.".repeat(10)));
        const result = await extractPDFTextInBrowser(buffer);
        assert.match(result.error ?? "", /does not appear to be a valid PDF/);
    });

    it("rejects a PDF with no extractable text (image-based/scanned stub)", async () => {
        const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >> endobj
4 0 obj << /Length 0 >>
stream

endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000226 00000 n
trailer << /Size 5 /Root 1 0 R >>
startxref
280
%%EOF`;
        const result = await extractPDFTextInBrowser(toArrayBuffer(Buffer.from(pdf)));
        assert.ok(result.error, "should error for a PDF with no text");
        assert.match(result.error!, /No text could be extracted|Could not parse/);
    });
});

describe("extractDocxTextInBrowser", () => {
    it("extracts text from a minimal valid .docx via mammoth's browser build (arrayBuffer, not Node buffer)", async () => {
        const buffer = buildTestDocx([
            "Jane Smith",
            "Senior Product Manager with 8 years of experience in SaaS product management and cross-functional team leadership.",
        ]);
        const result = await extractDocxTextInBrowser(buffer);
        assert.ok(!result.error, `should not error: ${result.error}`);
        assert.ok(result.text?.includes("Jane Smith"));
        assert.ok(result.text?.includes("cross-functional team leadership"));
    });

    it("rejects a .docx with too little extractable text", async () => {
        const buffer = buildTestDocx(["Hi"]);
        const result = await extractDocxTextInBrowser(buffer);
        assert.match(result.error ?? "", /Could not extract text from DOCX/);
    });

    it("rejects a buffer that isn't a valid zip at all", async () => {
        const result = await extractDocxTextInBrowser(toArrayBuffer(Buffer.from("not a docx file")));
        assert.match(result.error ?? "", /Failed to extract text from DOCX/);
    });
});
