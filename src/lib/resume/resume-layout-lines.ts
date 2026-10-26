/**
 * A résumé's text as the lines a reader sees, whatever layout printed it:
 * invisible characters removed, a two-column page read one column after the
 * other (as its PDF stores it), letter-spaced words closed up
 * ("P R O F I L E"), every list mark printed as "• ", and table cells (tabs,
 * wide gaps) split by " | ". Pure. `isHeading` is the parser's heading
 * test, passed in so this file sits below the parser (as unwrap-lines.ts).
 */

/** Soft hyphen, zero-width space/joiners, word joiner, BOM: printed as nothing. */
const INVISIBLE_RE = /[­​-‍⁠﻿]/g;

/** A list mark before a space ("➢ ", "✓ ", "– ", a private-use glyph): any symbol that
 *  cannot start a word, number, bracket, quote or heading number. A pictograph
 *  ("📍 ", "✉ ") is the icon labelling a contact line, so it stays. */
const LIST_MARK_RE = /^(?!\p{Extended_Pictographic})[^\p{L}\p{N}\s"'“‘(\[{#@$%&/\\.,:;!?|]\s+/u;

/** "J A M E S" or "E X P E R I E N C E": a word printed one letter at a time. */
const SPACED_WORD_RE = /^(?:[\p{L}\p{N}&] ){2,}[\p{L}\p{N}&]$/u;

/** A run of spaces wide enough to separate two cells, and where the next cell starts. */
const CELL_GAP_RE = / {3,}(?=\S)/g;

/** Rows needed to call a shared cell start a column, not a coincidence. */
const MIN_COLUMN_ROWS = 3;
/** How far a row's second cell may start from the column's edge, in characters. */
const COLUMN_SLACK = 2;

function cellStarts(row: string): number[] {
    return [...row.matchAll(CELL_GAP_RE)].map((m) => (m.index ?? 0) + m[0].length);
}

/** Where `row` splits at the column starting near `edge`: [left, right]. */
function splitAtColumn(row: string, edge: number): [string, string] {
    const start = cellStarts(row).find((s) => Math.abs(s - edge) <= COLUMN_SLACK);
    return start === undefined ? [row, ""] : [row.slice(0, start), row.slice(start)];
}

/**
 * A page printed in two columns, read left column then right: the text
 * column most rows' second cell starts at, when both columns open a section
 * there. A table's gaps don't qualify, since only one of its columns holds
 * headings. Rows with no second cell stay in the left column.
 */
function readColumns(rows: string[], isHeading: (line: string) => boolean): string[] {
    const counts = new Map<number, number>();
    for (const row of rows) for (const s of cellStarts(row)) counts.set(s, (counts.get(s) ?? 0) + 1);
    const [edge, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    if (count < MIN_COLUMN_ROWS) return rows;
    const cells = rows.map((row) => splitAtColumn(row, edge));
    const opensSection = (side: 0 | 1) => cells.some((c) => isHeading(c[side].trim()));
    if (!opensSection(0) || !opensSection(1)) return rows;
    return [...cells.map((c) => c[0]), ...cells.map((c) => c[1])];
}

function closeLetterSpacing(line: string): string {
    const words = line.split(/\s{2,}/);
    return words.every((w) => SPACED_WORD_RE.test(w)) ? words.map((w) => w.replace(/ /g, "")).join(" ") : line;
}

/** One printed line as a reader takes it, or "" when it holds nothing. */
function readLine(raw: string): string {
    const line = closeLetterSpacing(raw.trim());
    return line
        .replace(LIST_MARK_RE, "• ")
        .replace(/:\s*\t+\s*/g, ": ")
        .replace(/\s*\t+\s*|\s{3,}/g, " | ");
}

export function resumeLayoutLines(text: string, isHeading: (line: string) => boolean): string[] {
    const rows = text.replace(INVISIBLE_RE, "").replace(/\f/g, "\n").replace(/\r\n?/g, "\n").split("\n");
    return readColumns(rows, isHeading).map(readLine).filter(Boolean);
}
