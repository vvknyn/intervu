import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractPDFTextInBrowser } from "../../src/lib/local-ai/extract-in-browser";
import { parsePdfForProfileReview } from "../../src/lib/resume/profile-review-parse";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";

/**
 * Flow 29 — a PDF whose extracted text is content-stream operators must not
 * become Core Skills, and must not open the “Parsed on-device” review with
 * an empty name, title, and location, years 0, and Save offered.
 * Synthetic bytes only. Do not point this at a real résumé file.
 */

function toArrayBuffer(buf: Buffer): ArrayBuffer {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Uncompressed one-page PDF. Offsets are computed so pdf.js accepts the page tree. */
function buildPdf(lines: string[]): ArrayBuffer {
    const ops = lines
        .map((line, index) => {
            const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
            return `${index === 0 ? "" : "0 -14 Td\n"}(${escaped}) Tj`;
        })
        .join("\n");
    const stream = `BT\n/F1 11 Tf\n72 720 Td\n${ops}\nET`;
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let body = "%PDF-1.4\n";
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) {
        offsets.push(Buffer.byteLength(body));
        body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefAt = Buffer.byteLength(body);
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) {
        xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    return toArrayBuffer(Buffer.from(body + xref + trailer));
}

/** Text operands are the operators themselves, so extraction yields a content stream. */
function operatorPdf(): ArrayBuffer {
    return buildPdf([
        "ET",
        "BT",
        "/F2 9.5 Tf",
        "10.9249999999999989 TL",
        "0 g",
        "40.507 Td",
        "/F1 9.5 Tf",
        "CORE COMPETENCIES",
        "ET",
        "BT",
        "/F2 9.5 Tf",
        "75.07 Td",
    ]);
}

function readableResumePdf(): ArrayBuffer {
    return buildPdf([
        "Jane Doe",
        "Senior Software Engineer",
        "Toronto, Ontario",
        "SKILLS",
        "TypeScript, React, Node.js, PostgreSQL",
        "EXPERIENCE",
        "Acme Corp",
        "Senior Software Engineer",
        "Jan 2020 - Present",
        "Led migration to microservices architecture",
    ]);
}

const FORBIDDEN_SKILL_TOKENS = ["ET", "BT", "Tf", "Td", "/F2"] as const;

describe("profile review false success", () => {
    it("does not offer a Parsed on-device review when PDF text is content-stream operators", async () => {
        const extracted = await extractPDFTextInBrowser(operatorPdf());
        assert.equal(extracted.error, undefined);
        const text = extracted.text ?? "";
        for (const token of FORBIDDEN_SKILL_TOKENS) {
            assert.ok(text.includes(token), `fixture text should contain ${token}`);
        }

        // Unguarded rules parse is the bug: those operators become Core Skills,
        // and name / title / location / years stay empty.
        const unguarded = structureResumeText(text);
        const unguardedSkills = unguarded.competencies.flatMap((category) => category.skills).join(", ");
        for (const token of FORBIDDEN_SKILL_TOKENS) {
            assert.ok(unguardedSkills.includes(token), `unguarded skills should contain ${token}`);
        }
        assert.equal(unguarded.profile.name ?? "", "");
        assert.equal(unguarded.profile.profession ?? "", "");
        assert.equal(unguarded.profile.location ?? "", "");
        assert.equal(unguarded.profile.yearsOfExperience ?? 0, 0);

        const review = await parsePdfForProfileReview(operatorPdf(), { skipDownload: true });
        assert.equal(review.ok, false);
        if (!review.ok) {
            assert.match(review.error, /Could not read résumé text/);
            assert.equal("skillsString" in review, false);
            assert.equal("parsed" in review, false);
        }
        const offered = review.ok ? review.skillsString : "";
        for (const token of FORBIDDEN_SKILL_TOKENS) {
            assert.equal(offered.includes(token), false, `Core Skills must not contain ${token}`);
        }
    });

    it("still accepts a synthetic PDF whose text is a résumé", async () => {
        const review = await parsePdfForProfileReview(readableResumePdf(), { skipDownload: true });
        assert.equal(review.ok, true);
        if (review.ok) {
            assert.equal(review.parsed.profile.name, "Jane Doe");
            assert.match(review.parsed.profile.profession ?? "", /Software Engineer/);
            assert.match(review.parsed.profile.location ?? "", /Toronto/);
            assert.ok((review.parsed.profile.yearsOfExperience ?? 0) > 0);
            for (const token of FORBIDDEN_SKILL_TOKENS) {
                assert.equal(review.skillsString.includes(token), false);
            }
            assert.match(review.skillsString, /TypeScript/);
        }
    });

    it("landing review shows Parsed on-device and Save only after the gate accepts", () => {
        const src = readFileSync(
            path.join(process.cwd(), "src/components/onboarding/LandingOnboardingView.tsx"),
            "utf8",
        );
        assert.match(src, /parsePdfForProfileReview/);
        assert.doesNotMatch(src, /file\.text\(\)/);
        const reviewBranch = src.slice(src.indexOf("parsedResume ?"));
        assert.match(reviewBranch, /Parsed on-device/);
        assert.match(reviewBranch, /Save &amp; Start matching roles/);
    });
});
