/**
 * Rejoin a PDF's visual line wraps in stored résumé text.
 *
 * PDF text extraction used to emit one line per printed line, so a résumé
 * uploaded before the extractor learned the page layout
 * (`lib/local-ai/pdf-text-lines.ts`) is stored with every wrap as a line
 * break. Structuring that text split the summary into one paragraph per
 * printed line and cut skills in half ("Large-" / "Scale Migrations").
 * This repairs it when the text is read, from the text alone, so nothing
 * stored is rewritten.
 *
 * It only acts on text that looks hard-wrapped: many lines close to the same
 * full width, several of them followed by a line that starts mid-sentence.
 * A pasted résumé with one paragraph per line doesn't look like that and
 * passes through untouched.
 */

const MIN_MEASURED_LENGTH = 40;
/** Share of measured lines that must sit near the full width. */
const MIN_NEAR_FULL_SHARE = 0.3;
/** Lines that start mid-sentence after a full line, before we trust the text is hard-wrapped. */
const MIN_WRAP_EVIDENCE = 2;

const SENTENCE_END_RE = /[.!?]["')\]]*$/;
const BULLET_START_RE = /^[-*•−●◦▪]\s+/;
const HYPHEN_WRAP_RE = /\p{L}-$/u;

/** The line's printed width in characters: the 90th-percentile length of its long lines. */
function fullWidth(lines: string[]): number | null {
    const lengths = lines.map((l) => l.length).filter((n) => n >= MIN_MEASURED_LENGTH).sort((a, b) => a - b);
    if (lengths.length < 3) return null;
    return lengths[Math.floor(0.9 * (lengths.length - 1))];
}

function firstWord(line: string): string {
    return line.split(/\s+/, 1)[0] ?? "";
}

/** `line` would have fit its first word on the previous line if the printer hadn't run out of width,
 *  or `prev` is a ragged-right prose line (>=60% width, no sentence end) followed by a lowercase word. */
function isFull(prev: string, next: string, width: number): boolean {
    if (prev.length + 1 + firstWord(next).length > 0.95 * width) return true;
    return prev.length >= 0.6 * width && !SENTENCE_END_RE.test(prev) && /^\p{Ll}/u.test(next);
}

/** Starts mid-sentence: lowercase, a digit, or punctuation such as "<20-minute" or "(live)". */
function startsMidSentence(line: string): boolean {
    return /^[^\p{Lu}]/u.test(line);
}

function looksHardWrapped(lines: string[], width: number, isBoundary: (line: string) => boolean): boolean {
    const measured = lines.filter((l) => l.length >= MIN_MEASURED_LENGTH);
    const nearFull = measured.filter((l) => l.length >= 0.88 * width).length;
    if (nearFull / measured.length < MIN_NEAR_FULL_SHARE) return false;
    let evidence = 0;
    for (let i = 1; i < lines.length; i++) {
        const prev = lines[i - 1];
        const line = lines[i];
        if (isBoundary(prev) || isBoundary(line)) continue;
        if (isFull(prev, line, width) && /^\p{Ll}/u.test(line)) evidence++;
    }
    return evidence >= MIN_WRAP_EVIDENCE;
}

/**
 * Joins each wrapped line onto the one before it. A line is a wrap when the
 * line above is full (the wrap's first word wouldn't have fit on it) and the
 * sentence carries on: the line above doesn't end a sentence, or this line
 * starts mid-sentence. A full line that ends a sentence followed by a
 * capitalised line stays a break, because that's how one bullet ends and the
 * next begins. `isBoundary` lines (section headings, dated role lines) are
 * never joined to anything.
 */
export function unwrapHardWrappedLines(lines: string[], isBoundary: (line: string) => boolean = () => false): string[] {
    const width = fullWidth(lines);
    if (width === null || !looksHardWrapped(lines, width, isBoundary)) return lines;

    const out: string[] = [];
    let prevPrinted = "";
    for (const line of lines) {
        const last = out.length - 1;
        const joins =
            last >= 0 &&
            !isBoundary(prevPrinted) &&
            !isBoundary(line) &&
            !BULLET_START_RE.test(line) &&
            isFull(prevPrinted, line, width) &&
            (!SENTENCE_END_RE.test(prevPrinted) || startsMidSentence(line));
        if (joins) {
            out[last] = HYPHEN_WRAP_RE.test(out[last]) && /^\p{L}/u.test(line) ? `${out[last]}${line}` : `${out[last]} ${line}`;
        } else {
            out.push(line);
        }
        prevPrinted = line;
    }
    return out;
}
