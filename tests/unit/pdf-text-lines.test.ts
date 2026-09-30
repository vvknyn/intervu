import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractText } from "unpdf";
import { extractPDFTextInBrowser } from "../../src/lib/local-ai/extract-in-browser";
import { pdfPageText, type PdfTextItem } from "../../src/lib/local-ai/pdf-text-lines";
import { resumeDataFromPlainText } from "../../src/lib/resume/structure-resume-text";
import { unwrapHardWrappedLines } from "../../src/lib/resume/unwrap-lines";
import { WRAPPED_RESUME, buildWrappedResumePdf } from "../fixtures/wrapped-resume-pdf";

/**
 * A PDF résumé's wrapped lines come back as the paragraphs and bullets they
 * belong to: at upload (pdf-text-lines.ts, from the page layout) and when a
 * résumé stored before that is read (unwrap-lines.ts, from the text alone).
 * Before, every printed line was its own line, and the résumé page showed a
 * summary with a paragraph break at every line wrap.
 */

/** One printed text run at (x, y), about 5pt per character at size 10. */
function item(str: string, x: number, y: number, opts: { size?: number; hasEOL?: boolean; width?: number } = {}): PdfTextItem {
    const size = opts.size ?? 10;
    return { str, transform: [size, 0, 0, size, x, y], width: opts.width ?? str.length * size * 0.5, height: size, hasEOL: opts.hasEOL ?? true };
}

/** Words to fill a line of `chars` characters. */
function words(chars: number, seed = "word"): string {
    let out = "";
    while (out.length < chars) out += (out ? " " : "") + seed;
    return out.slice(0, chars).trimEnd();
}

describe("PDF extraction keeps paragraphs and bullets whole", () => {
    it("rejoins a wrapped summary, skills list and bullets from a real PDF", async () => {
        const result = await extractPDFTextInBrowser(buildWrappedResumePdf());
        assert.equal(result.error, undefined);
        const lines = result.text!.split("\n");
        assert.ok(lines.includes(WRAPPED_RESUME.summary), "summary is one line");
        assert.ok(lines.includes(WRAPPED_RESUME.skills), "skills list is one line");
        for (const bullet of WRAPPED_RESUME.bullets) assert.ok(lines.includes(`• ${bullet}`), `bullet is one line: ${bullet.slice(0, 30)}`);
        // Headings, the role line with its right-aligned dates, and the lines after them stay apart.
        assert.ok(lines.includes("SUMMARY") && lines.includes("EXPERIENCE") && lines.includes("EDUCATION"));
        assert.ok(lines.includes(`${WRAPPED_RESUME.role} ${WRAPPED_RESUME.dates}`));
        assert.ok(lines.includes(WRAPPED_RESUME.education));
    });

    it("structures the upload with the summary as one paragraph and every skill intact", async () => {
        const { text } = await extractPDFTextInBrowser(buildWrappedResumePdf());
        const data = resumeDataFromPlainText(text!);
        assert.equal(data.generatedSummary, WRAPPED_RESUME.summary);
        const skills = data.competencies.flatMap((c) => c.skills);
        assert.ok(skills.includes("Large-Scale Data Pipelines"));
        assert.ok(skills.includes("Event Sourcing (CQRS, Outbox, Sagas)"), "a bracketed list stays one skill");
        assert.ok(skills.includes("Incident Command"));
    });

    it("joins a line that the next word wouldn't have fit on, and keeps one that ends short", () => {
        const full = words(100);
        const text = pdfPageText([
            item(full, 50, 700),
            item("continues here and ends.", 50, 687),
            item("Next paragraph starts here.", 50, 674),
        ]);
        assert.equal(text, `${full} continues here and ends.\nNext paragraph starts here.`);
    });

    it("joins a hyphen wrap without a space", () => {
        const text = pdfPageText([item(`${words(94)} Large-`, 50, 700), item("Scale Migrations", 50, 687)]);
        assert.ok(text.endsWith("Large-Scale Migrations"), text);
        assert.equal(text.split("\n").length, 1);
    });

    it("keeps a full line that ends a sentence apart from a capitalised next line", () => {
        const full = `${words(95)} done.`;
        assert.equal(pdfPageText([item(full, 50, 700), item("Led the next thing.", 50, 687)]).split("\n").length, 2);
    });

    it("never joins across a heading size change, an indent, a wide gap or a big vertical gap", () => {
        const full = words(100);
        const cases: PdfTextItem[][] = [
            [item(full, 50, 700), item("heading text", 50, 687, { size: 12 })],
            [item(full, 50, 700), item("indented line", 70, 687)],
            [item(full, 50, 700), item("far below", 50, 660)],
            [item("Role | Company", 50, 700, { hasEOL: false }), item("2019 – Present", 490, 700), item("lowercase start", 50, 687)],
        ];
        for (const items of cases) assert.equal(pdfPageText(items).split("\n").length, 2, JSON.stringify(items.map((i) => i.str)));
    });

    it("reads a bullet glyph drawn apart from its text as one bullet, and joins its continuation", () => {
        const text = pdfPageText([
            item("•", 54, 700, { hasEOL: false }),
            item(words(96), 66, 700),
            item("and wraps under the text.", 66, 687),
        ]);
        assert.equal(text, `• ${words(96)} and wraps under the text.`);
    });
});

describe("a résumé stored one printed line per line reads like the file", () => {
    it("rejoins the old extraction's lines when the résumé is structured", async () => {
        const { text: pages } = await extractText(new Uint8Array(buildWrappedResumePdf()));
        const stored = pages.join("\n\n");
        assert.ok(stored.split("\n").length > 16, "the old extraction printed one line per printed line");
        const data = resumeDataFromPlainText(stored);
        assert.equal(data.generatedSummary, WRAPPED_RESUME.summary);
        const skills = data.competencies.flatMap((c) => c.skills);
        assert.ok(skills.includes("Event Sourcing (CQRS, Outbox, Sagas)"));
        assert.ok(skills.includes("Incident Command"));
        assert.equal(data.experience[0].description, WRAPPED_RESUME.bullets.map((b) => `• ${b}`).join("\n"));
    });

    it("leaves a pasted résumé with one paragraph per line alone", () => {
        const lines = [
            "Jane Doe",
            "Backend engineer with 8 years building payments systems in Go and TypeScript across three companies.",
            "Led the ledger migration to Postgres with zero downtime",
            "Built a fraud scoring service used on every card payment in Canada",
            "Mentored six engineers and ran the on-call rotation for two years",
        ];
        assert.deepEqual(unwrapHardWrappedLines(lines), lines);
    });
});

describe("role and skill lines keep their brackets", () => {
    it("keeps a closing bracket on a project name and a bracketed skill list whole", () => {
        const data = resumeDataFromPlainText(
            [
                "Jordan Lee",
                "PROJECTS",
                "intervu.cc — Interview-Prep & Job-Search Platform (live) 2026 — Present",
                "• Built and operate a live web app.",
                "SKILLS",
                "Tools: Multi-Provider LLM Integration (Claude, OpenAI, Gemini), Next.js",
            ].join("\n"),
        );
        assert.equal(data.projects?.[0]?.company, "Interview-Prep & Job-Search Platform (live)");
        assert.deepEqual(data.competencies[0].skills, ["Multi-Provider LLM Integration (Claude, OpenAI, Gemini)", "Next.js"]);
    });
});
