/**
 * Résumé PDF rendering (R4/R5, 2026-08-09 user report: variant downloads
 * were a bare .md; the founder then asked the design to match a reference
 * PDF exactly — see the module doc on `parse-resume-content.ts` for the
 * content model this consumes).
 *
 * Split in two, per the "pure decision, thin I/O" rule:
 *   - `layoutResumeDocument` (pure): `ParsedResumeDocument` -> a paginated
 *     list of draw commands. Takes a `TextMeasurer` as a parameter rather
 *     than reaching for a live jsPDF instance itself, so pagination/
 *     alignment decisions (header centering, date right-alignment, never
 *     splitting a bullet across a page break) are unit-testable with a
 *     deterministic fake measurer — no PDF library, no snapshot-testing
 *     rendered bytes.
 *   - `renderResumePdf` (thin I/O): builds a real jsPDF instance (confirmed
 *     to work under plain Node — no canvas/browser dependency for
 *     text-only core-font rendering), wraps its measurement calls into a
 *     `TextMeasurer`, calls `layoutResumeDocument`, then just walks the
 *     result executing the matching jsPDF draw calls. No layout decisions
 *     live here.
 *
 * One renderer, three call sites: the pursuit-variant download
 * (`lib/pursuits/download-resume.ts`), the base résumé's PDF button
 * (`YourResumeSection.tsx`), and the R5a MCP-chat download link (the
 * pursuit page's `?download=pdf` auto-trigger) — all three hand this
 * exactly a `ParsedResumeDocument` and get back the identical layout.
 */
import { jsPDF } from "jspdf";
import type { ParsedResumeDocument, ParsedResumeBlock } from "./parse-resume-content";

export interface TextMeasurer {
  /** Width in points of `text` set at `size`pt in the given weight. */
  widthOf(text: string, size: number, bold: boolean): number;
  /** Greedy word-wrap of `text` to `maxWidth`pt at `size`pt — same contract
   *  as jsPDF's `splitTextToSize`. */
  wrap(text: string, maxWidth: number, size: number): string[];
}

export interface DrawText {
  text: string;
  x: number;
  y: number;
  align: "left" | "center" | "right";
  bold: boolean;
  size: number;
}
export interface DrawRule {
  y: number;
}
/** A bullet marker, drawn as a filled circle — never as a Unicode glyph
 *  ("●"/"•") through jsPDF's core "helvetica" font. Core fonts use
 *  WinAnsiEncoding, which has no codepoint for either character; asking
 *  jsPDF to draw one silently substitutes mojibake ("%Ï") instead of
 *  throwing, so this was invisible to any test that never rendered real
 *  bytes and read them back. `y` is the vertical CENTER of the circle
 *  (matches jsPDF's `circle(x, y, r, style)` contract), not a text
 *  baseline. */
export interface DrawDot {
  x: number;
  y: number;
  r: number;
}
export interface PageLayout {
  texts: DrawText[];
  rules: DrawRule[];
  dots: DrawDot[];
}
export interface ResumeLayout {
  pages: PageLayout[];
  pageWidth: number;
  pageHeight: number;
  marginX: number;
}

export interface PageMetrics {
  pageWidth: number;
  pageHeight: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
}

/** US Letter, tight margins — matches the reference design (Indigo-Digital-
 *  Product-Manager-resume-2026-08-07.pdf): ~0.55in sides, ~0.5in top/bottom. */
export const DEFAULT_PAGE_METRICS: PageMetrics = {
  pageWidth: 612,
  pageHeight: 792,
  marginX: 40,
  marginTop: 36,
  marginBottom: 40,
};

const NAME_SIZE = 19;
const CONTACT_SIZE = 8.5;
const HEADING_SIZE = 10;
const BODY_SIZE = 9.5;
const LINE_HEIGHT = 1.35;
const BULLET_INDENT = 12;
const BULLET_DOT_RADIUS = 1.5;
/** Gap between a section heading's text baseline (accounting for descenders)
 *  and the rule drawn beneath it — sized so the rule never crosses the
 *  glyphs above it (the "struck through" bug: the rule used to be placed
 *  mid-line-height, cutting through cap-height letters). */
const RULE_GAP_BELOW_TEXT = 3;
const SECTION_GAP_BEFORE = 14;
const GAP_AFTER_HEADING_RULE = 8;
const GAP_BETWEEN_BLOCKS = 5;
const GAP_ENTRY_TITLE_TO_BULLETS = 2;

function lh(size: number): number {
  return size * LINE_HEIGHT;
}

class PageCursor {
  pages: PageLayout[] = [];
  private current: PageLayout;
  y: number;
  readonly contentWidth: number;
  readonly maxY: number;

  constructor(private metrics: PageMetrics) {
    this.current = { texts: [], rules: [], dots: [] };
    this.pages.push(this.current);
    this.y = metrics.marginTop;
    this.contentWidth = metrics.pageWidth - metrics.marginX * 2;
    this.maxY = metrics.pageHeight - metrics.marginBottom;
  }

  /** Ensures `height`pt of vertical space remains on the CURRENT page,
   *  starting a fresh page first if it doesn't — the single chokepoint that
   *  guarantees an atomic unit (one bullet, one entry title line, one
   *  paragraph line) never splits across a page break: every caller measures
   *  its whole unit's height and reserves it here BEFORE emitting any of
   *  that unit's draw commands. */
  reserve(height: number): void {
    if (this.y + height > this.maxY && this.y > this.metrics.marginTop) {
      this.current = { texts: [], rules: [], dots: [] };
      this.pages.push(this.current);
      this.y = this.metrics.marginTop;
    }
  }

  text(t: Omit<DrawText, "x" | "align"> & { x?: number; align?: DrawText["align"] }): void {
    this.current.texts.push({ x: this.metrics.marginX, align: "left", ...t });
  }
  rule(): void {
    this.current.rules.push({ y: this.y });
  }
  dot(centerY: number, r: number): void {
    this.current.dots.push({ x: this.metrics.marginX + r, y: centerY, r });
  }
  advance(n: number): void {
    this.y += n;
  }
  get marginX() {
    return this.metrics.marginX;
  }
  get pageRight() {
    return this.metrics.pageWidth - this.metrics.marginX;
  }
  get pageCenterX() {
    return this.metrics.pageWidth / 2;
  }
}

/** Wraps `body` to `maxWidth`, with a BOLD `prefix` (e.g. "Category: ")
 *  glued onto the first line and every wrapped line after it starting flush
 *  left — the bold-label-then-prose shape the reference design's
 *  "CORE COMPETENCIES" lines use. The caller re-splits line 0 on `prefix`
 *  itself to draw it as two runs (bold label, normal continuation). */
function wrapWithPrefix(prefix: string, body: string, maxWidth: number, size: number, measure: TextMeasurer): string[] {
  return measure.wrap(`${prefix}${body}`, maxWidth, size);
}

function emitParagraphLines(cursor: PageCursor, lines: string[], size: number, bold: boolean, x?: number): void {
  cursor.reserve(lines.length * lh(size));
  for (const line of lines) {
    cursor.text({ text: line, y: cursor.y + lh(size) * 0.8, size, bold, ...(x !== undefined ? { x } : {}) });
    cursor.advance(lh(size));
  }
}

function emitBlock(cursor: PageCursor, block: ParsedResumeBlock, measure: TextMeasurer): void {
  const width = cursor.contentWidth;

  if (block.kind === "paragraph") {
    const lines = measure.wrap(block.text, width, BODY_SIZE);
    emitParagraphLines(cursor, lines, BODY_SIZE, false);
    cursor.advance(GAP_BETWEEN_BLOCKS);
    return;
  }

  if (block.kind === "competency") {
    const prefix = `${block.category}: `;
    const lines = wrapWithPrefix(prefix, block.items, width, BODY_SIZE, measure);
    cursor.reserve(lines.length * lh(BODY_SIZE));
    lines.forEach((line, idx) => {
      const y = cursor.y + lh(BODY_SIZE) * 0.8;
      if (idx === 0 && line.startsWith(prefix)) {
        // The trailing space is drawn AS PART OF the bold run itself, not
        // just accounted for via x-offset math — a separator synthesized
        // purely from positioning, with no actual space glyph in either
        // draw call, glued the two runs together in text-extraction (the
        // visual gap existed but no whitespace CHARACTER did — "Technical:
        // SQL" read back as "Technical:SQL"). Drawing `prefix` (WITH its
        // trailing space) as one bold text run guarantees a real space
        // character sits between the two runs.
        cursor.text({ text: prefix, y, size: BODY_SIZE, bold: true });
        const prefixWidth = measure.widthOf(prefix, BODY_SIZE, true);
        cursor.text({ text: line.slice(prefix.length), x: cursor.marginX + prefixWidth, y, size: BODY_SIZE, bold: false });
      } else {
        cursor.text({ text: line, y, size: BODY_SIZE, bold: false });
      }
      cursor.advance(lh(BODY_SIZE));
    });
    cursor.advance(GAP_BETWEEN_BLOCKS);
    return;
  }

  if (block.kind === "bullets") {
    for (const item of block.items) {
      const lines = measure.wrap(item, width - BULLET_INDENT, BODY_SIZE);
      cursor.reserve(lines.length * lh(BODY_SIZE));
      lines.forEach((line, idx) => {
        const y = cursor.y + lh(BODY_SIZE) * 0.8;
        // Drawn as a filled circle, never a text glyph — see DrawDot's doc
        // comment for why ("●"/"•" mojibake through jsPDF's core fonts).
        if (idx === 0) cursor.dot(y - BODY_SIZE * 0.32, BULLET_DOT_RADIUS);
        cursor.text({ text: line, x: cursor.marginX + BULLET_INDENT, y, size: BODY_SIZE, bold: false });
        cursor.advance(lh(BODY_SIZE));
      });
    }
    cursor.advance(GAP_BETWEEN_BLOCKS);
    return;
  }

  // entry: title/company left, date right, same line — then its bullets.
  const titleHeight = lh(HEADING_SIZE);
  cursor.reserve(titleHeight);
  const y = cursor.y + titleHeight * 0.8;
  cursor.text({ text: block.title, y, size: HEADING_SIZE, bold: true });
  if (block.dateRight) {
    cursor.text({ text: block.dateRight, x: cursor.pageRight, y, align: "right", size: BODY_SIZE, bold: false });
  }
  cursor.advance(titleHeight + GAP_ENTRY_TITLE_TO_BULLETS);
  emitBlock(cursor, { kind: "bullets", items: block.bullets }, measure);
}

/** Pure: `ParsedResumeDocument` -> paginated draw commands. See module doc
 *  for why measurement is injected rather than reaching for jsPDF here. */
export function layoutResumeDocument(
  doc: ParsedResumeDocument,
  measure: TextMeasurer,
  metrics: PageMetrics = DEFAULT_PAGE_METRICS,
): ResumeLayout {
  const cursor = new PageCursor(metrics);

  if (doc.name) {
    cursor.reserve(lh(NAME_SIZE));
    cursor.text({ text: doc.name, x: cursor.pageCenterX, y: cursor.y + lh(NAME_SIZE) * 0.8, align: "center", size: NAME_SIZE, bold: true });
    cursor.advance(lh(NAME_SIZE));
  }
  if (doc.contactLine) {
    cursor.reserve(lh(CONTACT_SIZE) + 4);
    cursor.advance(4);
    cursor.text({ text: doc.contactLine, x: cursor.pageCenterX, y: cursor.y + lh(CONTACT_SIZE) * 0.8, align: "center", size: CONTACT_SIZE, bold: false });
    cursor.advance(lh(CONTACT_SIZE));
  }

  for (const section of doc.sections) {
    if (section.heading) {
      cursor.reserve(SECTION_GAP_BEFORE + lh(HEADING_SIZE) + RULE_GAP_BELOW_TEXT + GAP_AFTER_HEADING_RULE);
      cursor.advance(SECTION_GAP_BEFORE);
      cursor.text({ text: section.heading, y: cursor.y + lh(HEADING_SIZE) * 0.8, size: HEADING_SIZE, bold: true });
      // Advance past the FULL text line box (not partway through it) before
      // placing the rule, plus a small explicit gap — the rule must sit
      // below the text's descent, never through the glyphs.
      cursor.advance(lh(HEADING_SIZE) + RULE_GAP_BELOW_TEXT);
      cursor.rule();
      cursor.advance(GAP_AFTER_HEADING_RULE);
    }
    for (const block of section.blocks) emitBlock(cursor, block, measure);
  }

  return { pages: cursor.pages, pageWidth: metrics.pageWidth, pageHeight: metrics.pageHeight, marginX: metrics.marginX };
}

function jsPdfMeasurer(doc: jsPDF): TextMeasurer {
  return {
    widthOf(text, size, bold) {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      return doc.getTextWidth(text);
    },
    wrap(text, maxWidth, size) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      return doc.splitTextToSize(text, maxWidth) as string[];
    },
  };
}

/** Thin I/O: builds a real jsPDF instance and executes `layoutResumeDocument`'s
 *  draw commands against it. Returns raw PDF bytes (works identically under
 *  Node — verified, core "helvetica" font needs no canvas — and in the
 *  browser, so the SAME function backs both a server route and a client
 *  download button). */
export function renderResumePdf(content: ParsedResumeDocument, metrics: PageMetrics = DEFAULT_PAGE_METRICS): ArrayBuffer {
  const doc = new jsPDF({ unit: "pt", format: [metrics.pageWidth, metrics.pageHeight] });
  const measure = jsPdfMeasurer(doc);
  const layout = layoutResumeDocument(content, measure, metrics);

  layout.pages.forEach((page, i) => {
    if (i > 0) doc.addPage();
    for (const rule of page.rules) {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.75);
      doc.line(metrics.marginX, rule.y, metrics.pageWidth - metrics.marginX, rule.y);
    }
    for (const dot of page.dots) {
      doc.setFillColor(0, 0, 0);
      doc.circle(dot.x, dot.y, dot.r, "F");
    }
    for (const t of page.texts) {
      doc.setFont("helvetica", t.bold ? "bold" : "normal");
      doc.setFontSize(t.size);
      doc.text(t.text, t.x, t.y, { align: t.align });
    }
  });

  return doc.output("arraybuffer") as ArrayBuffer;
}

/** Pure: `<Company>-<Role>-resume-<YYYY-MM-DD>` (no extension — the caller
 *  appends it), matching the founder's reference filename convention
 *  (Indigo-Digital-Product-Manager-resume-2026-08-07.pdf). Falls back
 *  gracefully when pursuit metadata is absent (a base-résumé download has
 *  no company/role at all) rather than producing an empty/broken name. */
export function deriveResumePdfFilename(meta: {
  company?: string | null;
  role?: string | null;
  fallbackLabel?: string | null;
  dateIso: string;
}): string {
  const slug = (s: string) =>
    s
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  const company = meta.company ? slug(meta.company) : "";
  const role = meta.role ? slug(meta.role) : "";
  const stem = company && role ? `${company}-${role}` : company || role || (meta.fallbackLabel ? slug(meta.fallbackLabel) : "") || "resume";
  const date = /^\d{4}-\d{2}-\d{2}/.test(meta.dateIso) ? meta.dateIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `${stem}-resume-${date}`;
}
