/**
 * A PDF page's text as the reader sees it: one line per paragraph or bullet,
 * not one per printed line.
 *
 * pdf.js reports every printed line as its own line, so a summary that wraps
 * across four lines came out as four lines and was shown as four paragraphs.
 * Its text items carry their position, so this rejoins a printed line with
 * the next when the next one's first word wouldn't have fit, meaning the
 * printer wrapped it. A line that ends short of the right edge ends its
 * paragraph or bullet, and a heading never joins the line above it. Pure,
 * so it runs in the browser (résumé bytes never leave the device) and in
 * unit tests.
 */

import { isResumeBoundaryLine } from "@/lib/resume/structure-resume-text";

/** The fields of a pdf.js `TextItem` this reads. */
export interface PdfTextItem {
    str: string;
    /** [a, b, c, d, x, y]: x and y are the item's left edge and baseline. */
    transform: number[];
    width: number;
    height: number;
    hasEOL?: boolean;
}

interface PrintedLine {
    text: string;
    /** Left edge of the line's text, after any bullet glyph. */
    left: number;
    right: number;
    y: number;
    size: number;
    startsWithBullet: boolean;
    /** The bullet glyph shares an item with the text, so `left` is the glyph's, not the text's. */
    bulletInText: boolean;
    /** Has a wide horizontal gap (a right-aligned date, a tab stop): not running prose. */
    tabular: boolean;
}

const BULLET_GLYPH_RE = /^[•●▪◦‣∙·⁃*–-]$/;
const SENTENCE_END_RE = /[.!?]["')\]]*$/;
const HYPHEN_WRAP_RE = /\p{L}-$/u;

function isBlank(str: string): boolean {
    return str.trim() === "";
}

/** Groups items into printed lines, the way pdf.js ends them (hasEOL or a new baseline). */
function printedLines(items: PdfTextItem[]): PrintedLine[] {
    const lines: PrintedLine[] = [];
    let parts: PdfTextItem[] = [];

    const finish = () => {
        const inked = parts.filter((p) => !isBlank(p.str));
        if (inked.length > 0) {
            const bullet = BULLET_GLYPH_RE.test(inked[0].str.trim()) && inked.length > 1;
            const body = bullet ? inked.slice(1) : inked;
            const joined = (from: PdfTextItem[]) => from.map((p) => p.str).join("").replace(/\s+/g, " ").trim();
            // A glyph drawn apart from its text still reads "• text".
            const text = bullet ? `${inked[0].str.trim()} ${joined(parts.slice(parts.indexOf(inked[0]) + 1))}` : joined(parts);
            const size = Math.max(...inked.map((p) => p.height));
            const charWidth = body.reduce((w, p) => w + p.width, 0) / Math.max(1, body.reduce((n, p) => n + p.str.length, 0));
            let tabular = false;
            for (let i = 1; i < body.length; i++) {
                const gap = body[i].transform[4] - (body[i - 1].transform[4] + body[i - 1].width);
                if (gap > 4 * Math.max(charWidth, 1)) tabular = true;
            }
            lines.push({
                text,
                left: body[0].transform[4],
                right: Math.max(...inked.map((p) => p.transform[4] + p.width)),
                y: inked[0].transform[5],
                size,
                startsWithBullet: bullet || /^[•●▪◦‣∙]\s/.test(text),
                bulletInText: !bullet && /^[•●▪◦‣∙]\s/.test(text),
                tabular,
            });
        }
        parts = [];
    };

    for (const item of items) {
        if (typeof item.str !== "string") continue;
        const inkedSoFar = parts.find((p) => !isBlank(p.str));
        if (inkedSoFar && !isBlank(item.str)) {
            const tolerance = Math.max(2, 0.5 * Math.max(inkedSoFar.height, item.height));
            if (Math.abs(item.transform[5] - inkedSoFar.transform[5]) > tolerance) finish();
        }
        parts.push(item);
        if (item.hasEOL) finish();
    }
    finish();
    return lines;
}

function firstWordLength(text: string): number {
    return (text.split(" ", 1)[0] ?? "").length;
}

function charWidth(line: PrintedLine): number {
    return (line.right - line.left) / Math.max(1, line.text.length);
}

/** Whether `next` continues `prev`'s paragraph because the printer ran out of width. */
function wrapsOnto(prev: PrintedLine, next: PrintedLine, rightEdge: number): boolean {
    if (prev.tabular || next.tabular || next.startsWithBullet) return false;
    if (isResumeBoundaryLine(prev.text) || isResumeBoundaryLine(next.text)) return false;
    if (Math.abs(prev.size - next.size) > 0.3) return false;
    const gap = prev.y - next.y;
    if (gap <= 0 || gap > 1.8 * Math.max(prev.size, next.size)) return false;
    // A continuation starts at the paragraph's left edge (or left of a first-line
    // indent), or under the text of a bullet whose glyph shares its first item.
    if (next.left > prev.left + (prev.bulletInText ? 24 : 1.5)) return false;
    // The next line's first word, plus a space, would have run past the right edge —
    // or `prev` is a ragged-right prose line (>=60% of line width, no sentence end) followed by a lowercase word.
    const needed = (1 + firstWordLength(next.text)) * charWidth(next);
    const lowercaseContinuation =
        !SENTENCE_END_RE.test(prev.text) &&
        /^\p{Ll}/u.test(next.text) &&
        prev.right - prev.left >= 0.6 * (rightEdge - prev.left);
    if (prev.right + needed <= rightEdge + 1 && !lowercaseContinuation) return false;
    // A full line that ends a sentence, then a capital: how one bullet ends and the next begins.
    if (SENTENCE_END_RE.test(prev.text) && /^\p{Lu}/u.test(next.text)) return false;
    return true;
}

/**
 * One page's text items to text: a line per paragraph, bullet or heading.
 *
 * The right edge is the widest line, which proves nothing on its own: on a
 * page of short lines the widest one is "full" by definition. So a page
 * joins lines only once it shows a real wrap: a full line that ends on a
 * comma or a word broken by a hyphen, or is followed by one that carries on
 * mid-sentence (starts lowercase). Otherwise it keeps one line per printed
 * line, as before.
 */
export function pdfPageText(items: PdfTextItem[]): string {
    const lines = printedLines(items);
    if (lines.length === 0) return "";
    const rightEdge = Math.max(...lines.map((l) => l.right));
    const wraps = lines.map((line, i) => i > 0 && wrapsOnto(lines[i - 1], line, rightEdge));
    const provesWrap = (i: number) => /^\p{Ll}/u.test(lines[i].text) || /(,|\p{L}-)$/u.test(lines[i - 1].text);
    if (!wraps.some((wrap, i) => wrap && provesWrap(i))) return lines.map((l) => l.text).join("\n");
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (wraps[i]) {
            const last = out.length - 1;
            out[last] = HYPHEN_WRAP_RE.test(out[last]) && /^\p{L}/u.test(line.text) ? `${out[last]}${line.text}` : `${out[last]} ${line.text}`;
        } else {
            out.push(line.text);
        }
    }
    return out.join("\n");
}
