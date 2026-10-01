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
 * Justified body text draws word-by-word via pure numeric positioning
 * (`emitJustifiableSegments`), not jsPDF's native `align:"justify"` mode —
 * tried and reverted (fix round 2, 2026-08-09): native justify uses the
 * PDF word-spacing operator, which keeps real space CHARACTERS in the
 * content stream but was empirically confirmed to make some text-
 * extraction tooling read the page's content BLOCKS out of original
 * document order (own visual rendering was fine; the extracted text
 * transcript wasn't). The per-word approach's own tradeoff (a boundary
 * gap that's numerically correct but occasionally under-detected as
 * whitespace by such tooling) is the smaller, better-understood risk —
 * pixel-verified correct at 300dpi for both fixture shapes, every gap on
 * a line uniform, real PDF-byte positions confirmed via direct content-
 * stream inspection.
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
/** Multiplier on the natural space width for a RAGGED (non-justified,
 *  bare-minimum-gap) multi-segment line — see `emitJustifiableSegments`'s
 *  doc for why this is the one gap on the page with no built-in stretch. */
const RAGGED_GAP_PADDING = 1.15;

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

  // `t.x ?? this.metrics.marginX` (not a spread-then-default object
  // literal) is deliberate: a caller forwarding a possibly-`undefined`
  // local via shorthand property syntax (`{ x, ... }`) still gives the
  // object an OWN `x` key even when its value is `undefined` — a spread
  // default (`{ x: marginX, ...t }`) would let that `undefined` silently
  // CLOBBER the default instead of falling back to it, producing a NaN
  // coordinate jsPDF's own text() then throws on ("Invalid arguments
  // passed to jsPDF.text") — caught once by actually rendering real bytes,
  // not just the pure layout tests.
  text(t: Omit<DrawText, "x" | "align"> & { x?: number; align?: DrawText["align"] }): void {
    this.current.texts.push({ ...t, x: t.x ?? this.metrics.marginX, align: t.align ?? "left" });
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

interface WordSegment {
  text: string;
  bold: boolean;
}

/**
 * Draws one line as a sequence of word-ish segments at `x`, word-spaced to
 * fill `maxWidth` when `justify` is true and there's more than one segment
 * — the standard "ragged last line" typographic rule means only the FINAL
 * line of a paragraph/bullet/competency-continuation ever passes
 * `justify: false` (visually confirmed against the founder's reference
 * PDF: its summary paragraph, competency lists, and bullets are all
 * justified except each one's own last line).
 *
 * A "segment" is usually one word, but a competency line's bold category
 * label is ALSO one segment (its own run, own weight) participating in the
 * SAME gap computation as the ordinary words after it — treating the
 * label-to-first-word gap as a separate, always-natural-width step (an
 * earlier version of this fix did exactly that) made a justified line's
 * OWN label boundary visibly tighter than its own stretched word gaps,
 * since every other gap on that line was stretched to fill the width and
 * the label gap alone wasn't. One gap computation across every segment on
 * the line is what keeps it visually uniform.
 *
 * Every segment draws as its own `DrawText` command, positioned by pure
 * numeric accumulation (segment width + a computed gap) — never by
 * embedding a leading or trailing space CHARACTER in a drawn string.
 * Verified empirically (fix round 2, 2026-08-09): jsPDF silently drops
 * boundary whitespace from an independently-positioned `text()` call for
 * width/advance purposes even though `getTextWidth()` reports it correctly
 * — this is DEFECT #6's root cause (a bold label's trailing space collided
 * into the next run). Pixel-verified at 300dpi against the founder's
 * reference for both fixture shapes and multiple label lengths.
 */
function emitJustifiableSegments(cursor: PageCursor, segments: WordSegment[], x: number, y: number, maxWidth: number, size: number, justify: boolean, measure: TextMeasurer): void {
  if (segments.length === 0) return;
  const homogeneous = segments.every((s) => s.bold === segments[0].bold);
  // Ragged, single-weight (the common case: an ordinary paragraph/bullet's
  // last line, or any line with no bold label at all) draws as ONE string,
  // trusting jsPDF's own native word-spacing rather than reconstructing it
  // — simplest and safest for the case that doesn't need per-segment
  // positioning at all.
  if (!justify && homogeneous) {
    cursor.text({ text: segments.map((s) => s.text).join(" "), x, y, size, bold: segments[0].bold });
    return;
  }
  if (segments.length === 1) {
    cursor.text({ text: segments[0].text, x, y, size, bold: segments[0].bold });
    return;
  }
  const widths = segments.map((s) => measure.widthOf(s.text, size, s.bold));
  const spaceWidth = measure.widthOf(" ", size, false);
  if (!justify) {
    // Ragged but mixed-weight (a label + its continuation on a single-line
    // block's own last line) — natural gaps, but still one command per
    // segment since the weight change forces separate runs. A bare
    // single-space-width gap is the tightest one this module ever draws
    // (a justified line's own gaps are always wider, stretched to fill the
    // line) — RAGGED_GAP_PADDING gives it a little headroom so it reads
    // unambiguously as a word boundary, pixel-verified indistinguishable
    // from normal spacing at this font size.
    let wx = x;
    segments.forEach((seg, i) => {
      cursor.text({ text: seg.text, x: wx, y, size, bold: seg.bold });
      wx += widths[i] + spaceWidth * RAGGED_GAP_PADDING;
    });
    return;
  }
  const naturalWidth = widths.reduce((a, b) => a + b, 0) + spaceWidth * (segments.length - 1);
  const gapWidth = spaceWidth + Math.max(0, maxWidth - naturalWidth) / (segments.length - 1);
  let wx = x;
  segments.forEach((seg, i) => {
    cursor.text({ text: seg.text, x: wx, y, size, bold: seg.bold });
    wx += widths[i] + gapWidth;
  });
}

/** Plain (single-weight) line -> word segments — the common case every
 *  paragraph/bullet line uses; `emitJustifiableSegments` doesn't care
 *  whether a segment list came from one weight or several. */
function emitJustifiableLine(cursor: PageCursor, text: string, x: number, y: number, maxWidth: number, size: number, bold: boolean, justify: boolean, measure: TextMeasurer): void {
  const words = text.split(/\s+/).filter(Boolean);
  emitJustifiableSegments(cursor, words.map((w) => ({ text: w, bold })), x, y, maxWidth, size, justify, measure);
}

function emitParagraphLines(cursor: PageCursor, lines: string[], size: number, bold: boolean, width: number, measure: TextMeasurer, x?: number): void {
  cursor.reserve(lines.length * lh(size));
  lines.forEach((line, idx) => {
    const isLast = idx === lines.length - 1;
    emitJustifiableLine(cursor, line, x ?? cursor.marginX, cursor.y + lh(size) * 0.8, width, size, bold, !isLast, measure);
    cursor.advance(lh(size));
  });
}

function emitBlock(cursor: PageCursor, block: ParsedResumeBlock, measure: TextMeasurer): void {
  const width = cursor.contentWidth;

  if (block.kind === "paragraph") {
    const lines = measure.wrap(block.text, width, BODY_SIZE);
    emitParagraphLines(cursor, lines, BODY_SIZE, false, width, measure);
    cursor.advance(GAP_BETWEEN_BLOCKS);
    return;
  }

  if (block.kind === "competency") {
    const prefix = `${block.category}: `;
    const label = block.category + ":"; // no trailing space — the label is ONE segment in the same justify computation as the words after it, never a separately-positioned prefix (see emitJustifiableSegments' doc — DEFECT #6 + the label-gap-looked-tighter-than-its-own-line's-word-gaps follow-up)
    const lines = wrapWithPrefix(prefix, block.items, width, BODY_SIZE, measure);
    cursor.reserve(lines.length * lh(BODY_SIZE));
    lines.forEach((line, idx) => {
      const y = cursor.y + lh(BODY_SIZE) * 0.8;
      const isLast = idx === lines.length - 1;
      if (idx === 0 && line.startsWith(prefix)) {
        const contentWords = line.slice(prefix.length).split(/\s+/).filter(Boolean);
        const segments: WordSegment[] = [{ text: label, bold: true }, ...contentWords.map((w) => ({ text: w, bold: false }))];
        emitJustifiableSegments(cursor, segments, cursor.marginX, y, width, BODY_SIZE, !isLast, measure);
      } else {
        emitJustifiableLine(cursor, line, cursor.marginX, y, width, BODY_SIZE, false, !isLast, measure);
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
        const isLast = idx === lines.length - 1;
        emitJustifiableLine(cursor, line, cursor.marginX + BULLET_INDENT, y, width - BULLET_INDENT, BODY_SIZE, false, !isLast, measure);
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

export function jsPdfMeasurer(doc: jsPDF): TextMeasurer {
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

// Re-exported for existing importers; new code imports it from
// pdf-filename.ts, which doesn't pull jsPDF into the importing bundle.
export { deriveResumePdfFilename } from "./pdf-filename";
