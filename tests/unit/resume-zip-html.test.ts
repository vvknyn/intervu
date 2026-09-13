import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";
import { resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { resumeDataToZipHtml } from "@/lib/resume/zip-html";

const CSM_GOLDEN = readFileSync(
    path.join(process.cwd(), "tests/fixtures/vivek-csm-golden-resume.txt"),
    "utf8",
);
const PM_FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/vivek-pm-resume.txt"), "utf8");

describe("resumeDataToZipHtml", () => {
    it("golden CSM HTML matches zip visual system from ResumeData (not markdown parse)", () => {
        const html = resumeDataToZipHtml(resumeDataFromPlainText(CSM_GOLDEN));

        assert.match(html, /Vivek Narayanan/);
        assert.match(html, /Richmond Hill, Ontario/);
        assert.match(html, /PROFESSIONAL SUMMARY/);
        assert.match(html, /CORE COMPETENCIES/);
        assert.match(html, /PROFESSIONAL EXPERIENCE/);
        assert.match(html, /EDUCATION &amp; PROFESSIONAL DEVELOPMENT|EDUCATION & PROFESSIONAL DEVELOPMENT/);

        assert.match(html, /<strong>Customer Success &amp; Account Management:<\/strong>/);
        assert.match(html, /<strong>Delivery &amp; Process Excellence:<\/strong>/);
        assert.match(html, /<strong>Platforms &amp; Tools:<\/strong>/);
        assert.match(html, /resume-entry-title[^<]*Client-facing Product Manager \| TELUS Health Wellbeing/);
        assert.match(html, /resume-entry-dates/);

        assert.match(html, /@page\s*\{\s*size:\s*letter/);
        assert.match(html, /resume-bullets li::before/);
        assert.match(html, /border-radius:\s*50%/);

        assert.doesNotMatch(html, /\.resume-paragraph\s*\{[^}]*letter-spacing/);
        assert.doesNotMatch(html, /\.resume-bullets li\s*\{[^}]*letter-spacing/);
        assert.doesNotMatch(html, /\*\*:/);
        assert.doesNotMatch(html, /<strong>:<\/strong>/);
        assert.doesNotMatch(html, /University \| Buffalo/);
        assert.ok(!/Hands-on with/i.test(html));
    });

    it("PM fixture keeps three Category: skill-list lines — no per-skill : orphans", () => {
        const data = resumeDataFromPlainText(PM_FIXTURE);
        const html = resumeDataToZipHtml(data);
        const doc = resumeDataToParsedDocument(data);

        const comp = doc.sections.find((s) => s.heading === "CORE COMPETENCIES");
        assert.ok(comp);
        const cats = comp!.blocks.filter((b) => b.kind === "competency");
        assert.equal(cats.length, 3, `expected 3 competency lines, got ${cats.length}`);
        for (const block of cats) {
            assert.ok(block.kind === "competency" && block.category.length > 1);
            assert.ok(block.kind === "competency" && block.items.includes(","), "skills stay comma-joined on one line");
        }

        assert.match(html, /<strong>Product:<\/strong>/);
        assert.match(html, /<strong>Delivery &amp; Execution:<\/strong>/);
        assert.match(html, /<strong>Technical:<\/strong>/);
        assert.doesNotMatch(html, /\*\*:/);
        assert.doesNotMatch(html, /<strong>:<\/strong>/);
        assert.doesNotMatch(html, />:\s*Requirements Analysis/);
        assert.match(html, /Richmond Hill, Ontario/);
        assert.match(html, /INDEPENDENT PROJECTS/);
        assert.doesNotMatch(html, /<li>INDEPENDENT PROJECTS<\/li>/);
        assert.match(html, /University at Buffalo/);
        assert.doesNotMatch(html, /University \| Buffalo/);
    });
});
