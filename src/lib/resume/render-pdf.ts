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
 *     alignment decisions (header centering, date right-alignment, per-line
 *     page breaks for multi-line bullets/paragraphs) are unit-testable with
 *     a deterministic fake measurer — no PDF library, no snapshot-testing
 *     rendered bytes.
 *   - `renderResumePdf` (thin I/O): builds a real jsPDF instance (confirmed
 *     to work under plain Node — no canvas/browser dependency for
 *     text-only core-font rendering), wraps its measurement calls into a
 *     `TextMeasurer`, calls `layoutResumeDocument`, then just walks the
 *     result executing the matching jsPDF draw calls. No layout decisions
 *     live here.
 *
 * Body text (summary paragraphs, bullets, competency lines) is left-aligned
 * with natural word spacing — ragged wrap, never stretched to fill the line
 * width. An earlier version justified every non-last wrapped line to match
 * a 2026-08-09 reference PDF; that produced unreadable uneven word gaps and
 * was reverted. Per-word positioning (not jsPDF's native `align:"justify"`)
 * is still used for mixed-weight competency lines (bold label + normal
 * words) so label-to-word gaps stay uniform at the natural space width.
 *
 * Verify layout fixes: `npx tsx --test tests/unit/resume-render-pdf.test.ts`
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

/** Extra clearance below a text baseline / dot center so descenders never
 *  clip into the bottom margin. Used by layout bounds checks and tests. */
export const DESCENT_PAD = 3;

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
/** Multiplier on the natural space width for a RAGGED multi-segment line —
 *  gives mixed-weight competency lines a little headroom so label-to-word
 *  gaps read unambiguously as word boundaries. */
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

  /** Vertical space remaining on the current page. */
  remaining(): number {
    return this.maxY - this.y;
  }

  /** Full drawable height between top and bottom margins. */
  pageContentHeight(): number {
    return this.maxY - this.metrics.marginTop;
  }

  newPage(): void {
    this.current = { texts: [], rules: [], dots: [] };
    this.pages.push(this.current);
    this.y = this.metrics.marginTop;
  }

  /** Ensures `height`pt of vertical space remains on the CURRENT page,
   *  starting a fresh page first if it doesn't — used for atomic multi-line
   *  blocks (section headings, entry title groups) that should not split. */
  reserve(height: number): void {
    if (this.y + height > this.maxY && !this.isAtPageTop()) {
      this.newPage();
    }
  }

  /** True when the cursor sits at the top margin of the current page
   *  (no content placed yet on this page). */
  isAtPageTop(): boolean {
    return this.y <= this.metrics.marginTop;
  }

  /** Reserve one line of `size`pt text, breaking to a new page when the
   *  drawn baseline (or a dot centered on it) would cross the bottom
   *  margin clearance. Per-line reservation lets long bullets and
   *  paragraphs continue on the next page instead of clipping. */
  reserveLine(size: number): void {
    const drawY = this.y + lh(size) * 0.8;
    if (drawY > this.maxY - DESCENT_PAD && !this.isAtPageTop()) {
      this.newPage();
    }
  }

  baselineY(size: number): number {
    return this.y + lh(size) * 0.8;
  }

  /** Guard: no draw command may land past the bottom margin. */
  assertDrawY(y: number): void {
    if (process.env.NODE_ENV === "production") return;
    const minY = this.metrics.marginTop;
    const maxDrawY = this.maxY - DESCENT_PAD;
    if (y < minY || y > maxDrawY) {
      throw new Error(`draw y=${y} outside [${minY}, ${maxDrawY}]`);
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
    this.assertDrawY(t.y);
    this.current.texts.push({ ...t, x: t.x ?? this.metrics.marginX, align: t.align ?? "left" });
  }
  rule(): void {
    this.current.rules.push({ y: this.y });
  }
  dot(centerY: number, r: number): void {
    this.assertDrawY(centerY);
    this.current.dots.push({ x: this.metrics.marginX + r, y: centerY, r });
  }
  advance(n: number): void {
    this.y += n;
  }
  advanceLine(size: number): void {
    this.y += lh(size);
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

/** True when `lineCount` lines of `size`pt can draw on the current page
 *  without their last baseline exceeding the descent clearance. */
function canFitLinesAt(cursor: PageCursor, lineCount: number, size: number): boolean {
  const lineHeight = lh(size);
  const lastDrawY = cursor.y + lineHeight * (lineCount - 1) + lineHeight * 0.8;
  return lastDrawY <= cursor.maxY - DESCENT_PAD;
}

/** If a multi-line unit has 2+ lines and fewer than ~2 lines remain on the
 *  current page, move the whole unit to the next page — unless the unit is
 *  taller than one page, in which case per-line splitting handles it. */
function maybeMoveMultilineUnit(cursor: PageCursor, lineCount: number, size: number): void {
  if (lineCount < 2) return;
  const lineHeight = lh(size);
  const unitHeight = lineCount * lineHeight;
  if (canFitLinesAt(cursor, 2, size)) return;
  if (unitHeight > cursor.pageContentHeight()) return;
  if (!cursor.isAtPageTop()) cursor.newPage();
}

/** Keep an experience entry title with at least its first bullet line when
 *  the pair fits on one page; otherwise fall back to per-line splitting. */
function maybeMoveEntryWithFirstBullet(cursor: PageCursor, hasBullets: boolean): void {
  if (!hasBullets) return;
  const groupHeight = lh(HEADING_SIZE) + GAP_ENTRY_TITLE_TO_BULLETS + lh(BODY_SIZE);
  const lastDrawY = cursor.y + lh(HEADING_SIZE) + GAP_ENTRY_TITLE_TO_BULLETS + lh(BODY_SIZE) * 0.8;
  if (lastDrawY <= cursor.maxY - DESCENT_PAD) return;
  if (groupHeight > cursor.pageContentHeight()) return;
  if (!cursor.isAtPageTop()) cursor.newPage();
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
 * Draws one line as a sequence of word-ish segments at `x` with natural
 * (ragged) word spacing. When `justify` is true the line is stretched to
 * fill `maxWidth` — retained for callers that need it, but body text never
 * passes `justify: true` (stretched gaps were unreadable on summary text).
 *
 * A "segment" is usually one word, but a competency line's bold category
 * label is ALSO one segment (its own run, own weight) with the same natural
 * gap computation as ordinary words after it.
 *
 * Every segment draws as its own `DrawText` command, positioned by pure
 * numeric accumulation (segment width + a computed gap) — never by
 * embedding a leading or trailing space CHARACTER in a drawn string.
 */
function emitJustifiableSegments(cursor: PageCursor, segments: WordSegment[], x: number, y: number, maxWidth: number, size: number, justify: boolean, measure: TextMeasurer): void {
  if (segments.length === 0) return;
  const homogeneous = segments.every((s) => s.bold === segments[0].bold);
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

function emitJustifiableLine(cursor: PageCursor, text: string, x: number, y: number, maxWidth: number, size: number, bold: boolean, justify: boolean, measure: TextMeasurer): void {
  const words = text.split(/\s+/).filter(Boolean);
  emitJustifiableSegments(cursor, words.map((w) => ({ text: w, bold })), x, y, maxWidth, size, justify, measure);
}

function emitParagraphLines(cursor: PageCursor, lines: string[], size: number, bold: boolean, width: number, measure: TextMeasurer, x?: number): void {
  maybeMoveMultilineUnit(cursor, lines.length, size);
  lines.forEach((line) => {
    cursor.reserveLine(size);
    const y = cursor.baselineY(size);
    emitJustifiableLine(cursor, line, x ?? cursor.marginX, y, width, size, bold, false, measure);
    cursor.advanceLine(size);
  });
}

function emitBulletLines(cursor: PageCursor, lines: string[], textWidth: number, measure: TextMeasurer): void {
  maybeMoveMultilineUnit(cursor, lines.length, BODY_SIZE);
  lines.forEach((line, idx) => {
    cursor.reserveLine(BODY_SIZE);
    const y = cursor.baselineY(BODY_SIZE);
    if (idx === 0) cursor.dot(y - BODY_SIZE * 0.32, BULLET_DOT_RADIUS);
    emitJustifiableLine(cursor, line, cursor.marginX + BULLET_INDENT, y, textWidth, BODY_SIZE, false, false, measure);
    cursor.advanceLine(BODY_SIZE);
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
    const label = block.category + ":";
    const lines = wrapWithPrefix(prefix, block.items, width, BODY_SIZE, measure);
    maybeMoveMultilineUnit(cursor, lines.length, BODY_SIZE);
    lines.forEach((line, idx) => {
      cursor.reserveLine(BODY_SIZE);
      const y = cursor.baselineY(BODY_SIZE);
      if (idx === 0 && line.startsWith(prefix)) {
        const contentWords = line.slice(prefix.length).split(/\s+/).filter(Boolean);
        const segments: WordSegment[] = [{ text: label, bold: true }, ...contentWords.map((w) => ({ text: w, bold: false }))];
        emitJustifiableSegments(cursor, segments, cursor.marginX, y, width, BODY_SIZE, false, measure);
      } else {
        emitJustifiableLine(cursor, line, cursor.marginX, y, width, BODY_SIZE, false, false, measure);
      }
      cursor.advanceLine(BODY_SIZE);
    });
    cursor.advance(GAP_BETWEEN_BLOCKS);
    return;
  }

  if (block.kind === "bullets") {
    const textWidth = width - BULLET_INDENT;
    for (const item of block.items) {
      emitBulletLines(cursor, measure.wrap(item, textWidth, BODY_SIZE), textWidth, measure);
    }
    cursor.advance(GAP_BETWEEN_BLOCKS);
    return;
  }

  // entry: title/company left, date right, same line — then its bullets.
  maybeMoveEntryWithFirstBullet(cursor, block.bullets.length > 0);
  cursor.reserveLine(HEADING_SIZE);
  const y = cursor.baselineY(HEADING_SIZE);
  cursor.text({ text: block.title, y, size: HEADING_SIZE, bold: true });
  if (block.dateRight) {
    cursor.text({ text: block.dateRight, x: cursor.pageRight, y, align: "right", size: BODY_SIZE, bold: false });
  }
  cursor.advanceLine(HEADING_SIZE);
  cursor.advance(GAP_ENTRY_TITLE_TO_BULLETS);
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
