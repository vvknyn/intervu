import { readFileSync } from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import type { ResumeData } from "../../../src/types/resume";

/**
 * Twenty-three invented résumés, one per template people actually send
 * (tests/fixtures/resume-templates/*.txt), each with what a reader should
 * get from it (truth.json), and the same text printed to a PDF the way a
 * word processor would, so the upload path is read from a real file.
 */

const DIR = path.join(process.cwd(), "tests/fixtures/resume-templates");

export interface TemplateTruth {
    /** The character column a two-column template's right frame starts at; its PDF draws that frame after the left one. */
    pdfColumn?: number;
    experience: Array<[title: string, company: string]>;
    education: Array<[degree: string, school: string]>;
    skills: string[];
    /** Lines that name the page, a block or a table's columns ("CURRICULUM VITAE", "PERSONAL INFORMATION",
     *  "Period | Role | Employer"), which no section keeps. */
    labels?: string[];
    /** The place printed beside an employer ("York", "Marietta, GA"): a role has no field for it, so the read leaves it out. */
    places?: string[];
}

export const TEMPLATES: Array<{ id: string; text: string; truth: TemplateTruth }> = Object.entries(
    JSON.parse(readFileSync(path.join(DIR, "truth.json"), "utf8")) as Record<string, TemplateTruth>,
).map(([id, truth]) => ({ id, text: readFileSync(path.join(DIR, `${id}.txt`), "utf8"), truth }));

const norm = (s: unknown) =>
    String(s ?? "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9+#]+/g, " ")
        .trim();
const same = (a: unknown, b: unknown) => norm(a) === norm(b);
const has = (hay: unknown, needle: unknown) => norm(hay).includes(norm(needle));

export interface Recall {
    found: number;
    total: number;
}

export const share = ({ found, total }: Recall) => (total === 0 ? 1 : found / total);

function recall<T>(truth: T[], isFound: (item: T) => boolean): Recall {
    return { found: truth.filter(isFound).length, total: truth.length };
}

/** How much of each section's truth the read found: every role with its employer, every school with its degree, every skill. */
export function sectionRecall(parsed: ResumeData, truth: TemplateTruth): Record<"experience" | "education" | "skills", Recall> {
    const skills = parsed.competencies.flatMap((c) => c.skills);
    return {
        experience: recall(truth.experience, ([title, company]) => parsed.experience.some((e) => same(e.role, title) && has(e.company, company))),
        education: recall(truth.education, ([degree, school]) => parsed.education.some((e) => has(e.degree, degree) && has(e.institution, school))),
        skills: recall(truth.skills, (s) => skills.some((x) => same(x, s))),
    };
}

function strings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === "object") return Object.values(value).flatMap(strings);
    return [];
}

const words = (s: string) => norm(s).split(" ").filter((w) => w.length >= 3 && /[a-z]/.test(w));

/** Input lines with a word the read kept nowhere, other than the template's labels and places: what it silently dropped. */
export function unplacedLines(text: string, parsed: ResumeData, { labels = [], places = [] }: Pick<TemplateTruth, "labels" | "places">): string[] {
    const kept = new Set([...strings(parsed), ...places].flatMap(words));
    return text
        .split("\n")
        .filter((line) => words(line).some((w) => !kept.has(w)) && !labels.some((label) => same(line, label)));
}

// ---- The PDF a word processor prints the template to ----

const LEFT = 40;
const RIGHT = 572;
const TOP = 50;
const LINE = 13;
const COLUMN_PT = 5.2;
const WIN_ANSI_HIGH = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const printable = (ch: string) => ch.charCodeAt(0) <= 0xff || WIN_ANSI_HIGH.includes(ch);
/** A list glyph the standard fonts can't print: a PDF's own bullet item stands in for it. */
const GLYPH_BULLET_RE = /^\s*([^\p{L}\p{N}\s])\s+/u;

/**
 * The template as a one-file PDF: each line printed where a word processor
 * puts it, a bullet glyph drawn apart from its text, a long line wrapped,
 * table cells and gap-separated columns at their own x. A two-column
 * template's right frame is drawn after its left one, as a page-layout
 * program writes them.
 */
export function templateResumePdf(text: string, pdfColumn?: number): ArrayBuffer {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const rows = text
        .replace(/[​-‍⁠﻿]/g, "")
        .split("\n")
        .map((row) => [...row].filter(printable).join(""));
    let y = TOP;
    const advance = (by = LINE) => {
        y += by;
        if (y > 750) {
            doc.addPage();
            y = TOP;
        }
    };

    if (pdfColumn) {
        const frames = [rows.map((r) => r.slice(0, pdfColumn)), rows.map((r) => r.slice(pdfColumn))];
        for (const frame of frames) {
            const x = frame === frames[0] ? LEFT : LEFT + pdfColumn * COLUMN_PT;
            frame.forEach((cell, i) => {
                if (cell.trim()) doc.text(cell.trim(), x + (cell.length - cell.trimStart().length) * COLUMN_PT, TOP + i * LINE);
            });
        }
        return doc.output("arraybuffer");
    }

    for (const raw of text.replace(/[​-‍⁠﻿]/g, "").split("\n")) {
        if (!raw.trim()) {
            advance(LINE / 2);
            continue;
        }
        const glyph = GLYPH_BULLET_RE.exec(raw);
        const isBullet = glyph !== null && !"-–—*#".includes(glyph[1]);
        const row = [...(isBullet ? raw.slice(glyph[0].length) : raw)].filter(printable).join("");
        if (isBullet) {
            doc.text("•", LEFT + 2, y);
            for (const line of doc.splitTextToSize(row, RIGHT - LEFT - 14) as string[]) {
                doc.text(line, LEFT + 14, y);
                advance();
            }
            continue;
        }
        const cells = row.includes("\t") ? row.split("\t") : row.trim().split(/\s{3,}/);
        if (cells.length === 1) {
            for (const line of doc.splitTextToSize(row.trim(), RIGHT - LEFT) as string[]) {
                doc.text(line, LEFT, y);
                advance();
            }
            continue;
        }
        let end = LEFT - 24;
        let column = 0;
        cells.forEach((cell, i) => {
            if (!row.includes("\t")) column = row.indexOf(cell, column);
            const stop = row.includes("\t") ? LEFT + (i * (RIGHT - LEFT)) / cells.length : LEFT + column * COLUMN_PT;
            const x = Math.max(stop, end + 24);
            doc.text(cell.trim(), x, y);
            end = x + doc.getTextWidth(cell.trim());
        });
        advance();
    }
    return doc.output("arraybuffer");
}
