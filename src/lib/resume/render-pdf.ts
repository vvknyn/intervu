/**
 * Résumé PDF rendering, on the device: the one exporter behind every résumé
 * download (the For you pack's Download & apply, Customize for this role,
 * the tracker's saved versions, the résumé page and editor).
 *
 * It prints in the layout of the person's own résumé when this device has
 * measured it (`layout-profile.ts`: paper, margins, type sizes, line
 * spacing, serif or sans, justified or ragged, page count), and in a tight
 * default otherwise. Then it fits the content to the original's page count
 * (`fitResumeLayout`): it tightens the spacing first, then the leading, and
 * only then the type, never below a readable floor. Content is never cut;
 * when it can't fit, it takes the next page at the original's size and says
 * so in the result.
 *
 * A résumé tailored to a role is always one page (`onePage`, Vivek
 * 2026-10-02: "1 pager always"). That fit may also tighten the borders to
 * 0.35in and the type a little further. When even that can't hold it, the
 * bullets that matter least for the role come out (`fitResumeOnOnePage`):
 * older roles' later bullets that don't use the role's words go first, and
 * an entry's first bullet never goes. They're listed in `leftOut`, so the
 * person is told what was left out.
 *
 * Split in two, per the "pure decision, thin I/O" rule:
 *   - `layoutResumeDocument` / `fitResumeLayout` (pure): a
 *     `ParsedResumeDocument` and a `ResumeStyle` -> paginated draw commands.
 *     Measurement is injected (`TextMeasurer`), so pagination and alignment
 *     are unit-testable with a fake measurer.
 *   - `renderResumePdf` (thin I/O): a real jsPDF document, its measurer, and
 *     the draw calls. Works under plain Node and in the browser.
 *
 * Text stays text a reader can copy and an applicant tracking system can
 * parse: every word keeps its real space character, including on justified
 * lines (each word is drawn with its trailing space and placed by number,
 * the way jsPDF itself justifies a Unicode font). An earlier version drew
 * words with no space characters at all, and some extractors read a
 * justified line as one run-together word ("AccountManagerandclient").
 *
 * Fonts: the built-in Helvetica/Times when every character has a WinAnsi
 * code; otherwise the caller supplies Liberation Sans/Serif (metric twins of
 * Helvetica/Times, SIL OFL, in public/fonts) and jsPDF embeds the glyphs it
 * uses. Without them, the few symbols WinAnsi lacks are spelled out ("→"
 * becomes "->") rather than printed as mojibake: the built-in fonts turn an
 * unknown character into garbage ("!'") without any error.
 */
import { jsPDF } from "jspdf";
import type { ParsedResumeDocument, ParsedResumeBlock } from "./parse-resume-content";
import type { ResumeLayoutProfile } from "./layout-profile";

export interface TextMeasurer {
  /** Width in points of `text` set at `size`pt in the given weight. */
  widthOf(text: string, size: number, bold: boolean): number;
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
  x1: number;
  x2: number;
  width: number;
}
/** A bullet marker, drawn as a filled circle — never as a "●"/"•" glyph,
 *  which the built-in fonts can't all print. `y` is the circle's centre. */
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

/** Everything that decides how a résumé prints. Sizes and spacing in points. */
export interface ResumeStyle {
  pageWidth: number;
  pageHeight: number;
  marginLeft: number;
  marginRight: number;
  /** Page top to the cap height of the first line. */
  marginTop: number;
  /** Page bottom to the descenders of the last line. */
  marginBottom: number;
  family: "sans" | "serif";
  nameSize: number;
  contactSize: number;
  headingSize: number;
  titleSize: number;
  dateSize: number;
  bodySize: number;
  /** Baseline-to-baseline distance of body lines, as a multiple of the type size. */
  lineHeight: number;
  justify: boolean;
  centeredHeader: boolean;
  bulletIndent: number;
  /** Below the contact line, before the first section. */
  headerGap: number;
  /** Above each later section heading. */
  sectionGap: number;
  /** Heading descenders to the rule. */
  ruleGap: number;
  /** Rule to the section's first line. */
  afterRuleGap: number;
  /** Between entries and paragraphs. */
  blockGap: number;
  /** Between bullets, and between skill lines. */
  itemGap: number;
  /** An entry's title line to its first bullet. */
  titleGap: number;
}

/** Cap height and descender depth of Helvetica/Times, as a fraction of the type size. */
const CAP_HEIGHT = 0.72;
const DESCENT = 0.21;
/** Name line pitch: display type sets tighter than body text. */
const NAME_LINE_HEIGHT = 1.15;
const HEADING_LINE_HEIGHT = 1.2;

/** Tight US Letter default for a résumé whose original layout this device
 *  hasn't seen (a paste, a .docx, an upload on another device). Spacing is
 *  in proportion to the body size, the way a dense one-page résumé sets it. */
export function defaultResumeStyle(): ResumeStyle {
  return withSpacing({
    pageWidth: 612,
    pageHeight: 792,
    marginLeft: 32,
    marginRight: 32,
    marginTop: 30,
    marginBottom: 30,
    family: "sans",
    nameSize: 17,
    contactSize: 8.75,
    headingSize: 10,
    titleSize: 9.75,
    dateSize: 9,
    bodySize: 9.5,
    lineHeight: 1.3,
    justify: true,
    centeredHeader: true,
    bulletIndent: 12,
  });
}

/** The style that prints like the measured original. */
export function styleFromLayoutProfile(profile: ResumeLayoutProfile): ResumeStyle {
  return withSpacing({
    pageWidth: profile.pageWidth,
    pageHeight: profile.pageHeight,
    marginLeft: profile.marginLeft,
    marginRight: profile.marginRight,
    marginTop: profile.marginTop,
    marginBottom: profile.marginBottom,
    family: profile.family,
    nameSize: profile.nameSize,
    contactSize: profile.contactSize,
    headingSize: profile.headingSize,
    titleSize: profile.titleSize,
    dateSize: profile.dateSize,
    bodySize: profile.bodySize,
    lineHeight: profile.lineHeight,
    justify: profile.justified,
    centeredHeader: profile.centeredHeader,
    bulletIndent: profile.bulletIndent,
  });
}

type Spacing = "headerGap" | "sectionGap" | "ruleGap" | "afterRuleGap" | "blockGap" | "itemGap" | "titleGap";

function withSpacing(style: Omit<ResumeStyle, Spacing>): ResumeStyle {
  const em = style.bodySize;
  return {
    ...style,
    headerGap: 0.7 * em,
    sectionGap: 0.85 * em,
    ruleGap: 0.25 * em,
    afterRuleGap: 0.4 * em,
    blockGap: 0.5 * em,
    itemGap: 0.1 * em,
    titleGap: 0.15 * em,
  };
}

/** The borders a one-page fit may tighten to: 0.35in, about where a dense résumé sets them. */
export const ONE_PAGE_MARGIN_FLOOR = 25.2;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The top of `compressResumeStyle`'s knob: 3, or 4 when the borders may move too. */
export function maxCompression(marginFloor: number | null = null): number {
  return marginFloor === null ? 3 : 4;
}

/**
 * One knob from "as designed" (0) to "as tight as readable"
 * (`maxCompression`): spacing halves over 0-1, the leading closes up over
 * 1-2, then the type shrinks toward `floorBodySize` over the last step.
 * Margins are the original's unless `marginFloor` is given (a one-page fit):
 * then they close in toward it over 2-3, before the type moves.
 */
export function compressResumeStyle(base: ResumeStyle, t: number, floorBodySize: number, marginFloor: number | null = null): ResumeStyle {
  const space = 1 - 0.5 * clamp01(t);
  const leadRoom = Math.max(0, Math.min(0.12, base.lineHeight - 1.12));
  const lineHeight = base.lineHeight - leadRoom * clamp01(t - 1);
  const borders = marginFloor === null ? 0 : clamp01(t - 2);
  const margin = (m: number) => m - (m - Math.min(m, marginFloor ?? m)) * borders;
  const floor = Math.min(base.bodySize, floorBodySize);
  const type = 1 - (1 - floor / base.bodySize) * clamp01(t - (maxCompression(marginFloor) - 1));
  return {
    ...base,
    marginLeft: margin(base.marginLeft),
    marginRight: margin(base.marginRight),
    marginTop: margin(base.marginTop),
    marginBottom: margin(base.marginBottom),
    lineHeight,
    nameSize: base.nameSize * type,
    contactSize: base.contactSize * type,
    headingSize: base.headingSize * type,
    titleSize: base.titleSize * type,
    dateSize: base.dateSize * type,
    bodySize: base.bodySize * type,
    bulletIndent: base.bulletIndent * type,
    headerGap: base.headerGap * space * type,
    sectionGap: base.sectionGap * space * type,
    ruleGap: base.ruleGap * Math.max(space, 0.8) * type,
    afterRuleGap: base.afterRuleGap * space * type,
    blockGap: base.blockGap * space * type,
    itemGap: base.itemGap * space * type,
    titleGap: base.titleGap * space * type,
  };
}

/** Smallest body size the fit may shrink to. A measured original keeps
 *  within about a tenth of its own size (15% when it must make one page);
 *  the default stops at 8pt. Never below 7pt. */
export function floorBodySizeFor(style: ResumeStyle, measured: boolean, onePage = false): number {
  if (!measured) return Math.min(style.bodySize, 8);
  return Math.min(style.bodySize, Math.max(7, style.bodySize * (onePage ? 0.85 : 0.9)));
}

interface Token {
  text: string;
  bold: boolean;
}

/** Greedy word wrap over tokens of mixed weight. A word wider than the line
 *  (a long URL) is broken across lines rather than run off the page. */
function wrapTokens(tokens: Token[], maxWidth: number, size: number, measure: TextMeasurer): Token[][] {
  const space = measure.widthOf(" ", size, false);
  const lines: Token[][] = [];
  let line: Token[] = [];
  let width = 0;
  const pieces: Token[] = [];
  for (const token of tokens) {
    if (measure.widthOf(token.text, size, token.bold) <= maxWidth) {
      pieces.push(token);
      continue;
    }
    let rest = token.text;
    while (rest) {
      let n = rest.length;
      while (n > 1 && measure.widthOf(rest.slice(0, n), size, token.bold) > maxWidth) n--;
      pieces.push({ text: rest.slice(0, n), bold: token.bold });
      rest = rest.slice(n);
    }
  }
  for (const piece of pieces) {
    const w = measure.widthOf(piece.text, size, piece.bold);
    if (line.length > 0 && width + space + w > maxWidth) {
      lines.push(line);
      line = [];
      width = 0;
    }
    width += (line.length > 0 ? space : 0) + w;
    line.push(piece);
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function words(text: string, bold = false): Token[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ text: w, bold }));
}

class PageCursor {
  pages: PageLayout[] = [];
  private current: PageLayout;
  /** Top of the next line box. */
  y: number;
  readonly left: number;
  readonly right: number;
  readonly contentWidth: number;
  private readonly maxY: number;
  /** Nothing drawn on this page yet. */
  atPageTop = true;

  constructor(private style: ResumeStyle) {
    this.current = { texts: [], rules: [], dots: [] };
    this.pages.push(this.current);
    this.y = style.marginTop;
    this.left = style.marginLeft;
    this.right = style.pageWidth - style.marginRight;
    this.contentWidth = this.right - this.left;
    this.maxY = style.pageHeight - style.marginBottom;
  }

  /** Starts a fresh page unless `height`pt (its last line ending at its
   *  descenders) still fits on this one. Every atomic unit (a bullet, a
   *  heading with its first line, a title with its first bullet) reserves
   *  its whole height here before drawing, so it never splits. */
  reserve(height: number): void {
    if (this.y + height > this.maxY && !this.atPageTop) {
      this.current = { texts: [], rules: [], dots: [] };
      this.pages.push(this.current);
      this.y = this.style.marginTop;
      this.atPageTop = true;
    }
  }

  text(t: Omit<DrawText, "align"> & { align?: DrawText["align"] }): void {
    this.current.texts.push({ ...t, align: t.align ?? "left" });
    this.atPageTop = false;
  }
  rule(y: number, width: number): void {
    this.current.rules.push({ y, x1: this.left, x2: this.right, width });
  }
  dot(x: number, y: number, r: number): void {
    this.current.dots.push({ x, y, r });
  }
  advance(n: number): void {
    this.y += n;
  }
  /** Space between blocks, dropped at the top of a page. */
  gap(n: number): void {
    if (!this.atPageTop) this.y += n;
  }
}

/**
 * Line geometry. A line of type `size` at `pitch` puts its cap height
 * `CAP_HEIGHT * size` below the top of its box, plus half the extra
 * leading, and its descenders end at `baseline + DESCENT * size`.
 */
function baselineIn(top: number, size: number, pitch: number): number {
  return top + (pitch - size) / 2 + (CAP_HEIGHT + 0.06) * size;
}
/** From the top of the first line box to the descenders of the last. */
function blockHeight(lines: number, size: number, pitch: number, between = 0): number {
  if (lines <= 0) return 0;
  return (lines - 1) * (pitch + between) + baselineIn(0, size, pitch) + DESCENT * size;
}

/**
 * Draws one wrapped line. Justified lines stretch their word gaps to the
 * right edge and draw each word with its own trailing space, so the space
 * survives text extraction. The last line of a paragraph, and a line that
 * would need gaps over three spaces wide, stay ragged.
 */
function drawLine(cursor: PageCursor, tokens: Token[], x: number, baseline: number, width: number, size: number, justify: boolean, measure: TextMeasurer): void {
  if (tokens.length === 0) return;
  const space = measure.widthOf(" ", size, false);
  const widths = tokens.map((t) => measure.widthOf(t.text, size, t.bold));
  const natural = widths.reduce((a, b) => a + b, 0) + space * (tokens.length - 1);
  const stretch = tokens.length > 1 ? (width - natural) / (tokens.length - 1) : 0;
  const stretched = justify && tokens.length > 1 && stretch > 0 && stretch <= space * 2;
  if (!stretched) {
    // Ragged: one run per weight, so a line reads back as one string.
    let wx = x;
    let i = 0;
    while (i < tokens.length) {
      let j = i;
      while (j + 1 < tokens.length && tokens[j + 1].bold === tokens[i].bold) j++;
      const run = tokens.slice(i, j + 1).map((t) => t.text).join(" ");
      cursor.text({ text: j + 1 < tokens.length ? `${run} ` : run, x: wx, y: baseline, size, bold: tokens[i].bold });
      wx += widths.slice(i, j + 1).reduce((a, b) => a + b, 0) + space * (j - i + 1);
      i = j + 1;
    }
    return;
  }
  let wx = x;
  tokens.forEach((t, i) => {
    cursor.text({ text: i < tokens.length - 1 ? `${t.text} ` : t.text, x: wx, y: baseline, size, bold: t.bold });
    wx += widths[i] + space + stretch;
  });
}

function drawWrapped(cursor: PageCursor, lines: Token[][], x: number, width: number, size: number, pitch: number, justify: boolean, measure: TextMeasurer): void {
  lines.forEach((line, idx) => {
    drawLine(cursor, line, x, baselineIn(cursor.y, size, pitch), width, size, justify && idx < lines.length - 1, measure);
    cursor.advance(pitch);
  });
}

function emitBullets(cursor: PageCursor, items: string[], style: ResumeStyle, measure: TextMeasurer): void {
  const size = style.bodySize;
  const pitch = size * style.lineHeight;
  const textX = cursor.left + style.bulletIndent;
  const width = cursor.contentWidth - style.bulletIndent;
  const r = Math.max(0.6, size * 0.14);
  items.forEach((item, idx) => {
    const lines = wrapTokens(words(item), width, size, measure);
    if (lines.length === 0) return;
    if (idx > 0) cursor.gap(style.itemGap);
    cursor.reserve(blockHeight(lines.length, size, pitch));
    const baseline = baselineIn(cursor.y, size, pitch);
    cursor.dot(cursor.left + Math.max(r, style.bulletIndent * 0.3), baseline - size * 0.3, r);
    drawWrapped(cursor, lines, textX, width, size, pitch, style.justify, measure);
  });
}

function firstLineHeight(block: ParsedResumeBlock, style: ResumeStyle): number {
  const body = blockHeight(1, style.bodySize, style.bodySize * style.lineHeight);
  if (block.kind !== "entry") return body;
  const title = blockHeight(1, style.titleSize, style.titleSize * style.lineHeight);
  return block.bullets.length > 0 ? title + style.titleGap + body : title;
}

function emitBlock(cursor: PageCursor, block: ParsedResumeBlock, style: ResumeStyle, measure: TextMeasurer): void {
  const size = style.bodySize;
  const pitch = size * style.lineHeight;
  const width = cursor.contentWidth;

  if (block.kind === "paragraph") {
    const lines = wrapTokens(words(block.text), width, size, measure);
    cursor.reserve(blockHeight(Math.min(lines.length, 2), size, pitch));
    lines.forEach((line, idx) => {
      cursor.reserve(blockHeight(1, size, pitch));
      drawLine(cursor, line, cursor.left, baselineIn(cursor.y, size, pitch), width, size, style.justify && idx < lines.length - 1, measure);
      cursor.advance(pitch);
    });
    return;
  }

  if (block.kind === "competency") {
    const lines = wrapTokens([{ text: `${block.category}:`, bold: true }, ...words(block.items)], width, size, measure);
    cursor.reserve(blockHeight(lines.length, size, pitch));
    drawWrapped(cursor, lines, cursor.left, width, size, pitch, style.justify, measure);
    return;
  }

  if (block.kind === "bullets") {
    emitBullets(cursor, block.items, style, measure);
    return;
  }

  // Entry: title left, dates right on its first line, then its bullets. The
  // title wraps short of the dates rather than running under them.
  const tSize = style.titleSize;
  const tPitch = tSize * style.lineHeight;
  const date = block.dateRight?.trim() ?? "";
  const dateWidth = date ? measure.widthOf(date, style.dateSize, false) : 0;
  const titleWidth = date ? Math.max(width * 0.5, width - dateWidth - tSize) : width;
  const titleLines = wrapTokens(words(block.title, true), titleWidth, tSize, measure);
  const firstBullet = block.bullets[0] ? Math.min(2, wrapTokens(words(block.bullets[0]), width - style.bulletIndent, size, measure).length) : 0;
  // Keep the title with its first bullet: never strand it at a page's foot.
  cursor.reserve(blockHeight(titleLines.length, tSize, tPitch) + (firstBullet ? style.titleGap + blockHeight(firstBullet, size, pitch) : 0));
  const baseline = baselineIn(cursor.y, tSize, tPitch);
  if (date) cursor.text({ text: date, x: cursor.right, y: baseline, align: "right", size: style.dateSize, bold: false });
  drawWrapped(cursor, titleLines, cursor.left, titleWidth, tSize, tPitch, false, measure);
  if (block.bullets.length > 0) {
    cursor.advance(style.titleGap);
    emitBullets(cursor, block.bullets, style, measure);
  }
}

/** Pure: `ParsedResumeDocument` + style -> paginated draw commands. */
export function layoutResumeDocument(doc: ParsedResumeDocument, measure: TextMeasurer, style: ResumeStyle = defaultResumeStyle()): ResumeLayout {
  const cursor = new PageCursor(style);
  const centerX = (cursor.left + cursor.right) / 2;
  const headerX = style.centeredHeader ? centerX : cursor.left;
  const headerAlign = style.centeredHeader ? "center" : "left";

  // The first line's cap height sits on the top margin.
  const first = doc.name ? { size: style.nameSize, pitch: style.nameSize * NAME_LINE_HEIGHT } : { size: style.headingSize, pitch: style.headingSize * HEADING_LINE_HEIGHT };
  cursor.y = style.marginTop - (baselineIn(0, first.size, first.pitch) - CAP_HEIGHT * first.size);

  if (doc.name) {
    const pitch = style.nameSize * NAME_LINE_HEIGHT;
    for (const line of wrapTokens(words(doc.name, true), cursor.contentWidth, style.nameSize, measure)) {
      cursor.text({ text: line.map((t) => t.text).join(" "), x: headerX, y: baselineIn(cursor.y, style.nameSize, pitch), align: headerAlign, size: style.nameSize, bold: true });
      cursor.advance(pitch);
    }
  }
  if (doc.contactLine) {
    const pitch = style.contactSize * style.lineHeight;
    cursor.advance(style.contactSize * 0.15);
    for (const line of wrapTokens(words(doc.contactLine), cursor.contentWidth, style.contactSize, measure)) {
      cursor.text({ text: line.map((t) => t.text).join(" "), x: headerX, y: baselineIn(cursor.y, style.contactSize, pitch), align: headerAlign, size: style.contactSize, bold: false });
      cursor.advance(pitch);
    }
  }

  const hPitch = style.headingSize * HEADING_LINE_HEIGHT;
  let firstSection = true;
  for (const section of doc.sections) {
    if (section.heading) {
      const headingBlock = blockHeight(1, style.headingSize, hPitch) + style.ruleGap + style.afterRuleGap;
      const lead = firstSection ? (doc.name || doc.contactLine ? style.headerGap : 0) : style.sectionGap;
      cursor.reserve(lead + headingBlock + (section.blocks[0] ? firstLineHeight(section.blocks[0], style) : 0));
      cursor.gap(lead);
      const baseline = baselineIn(cursor.y, style.headingSize, hPitch);
      cursor.text({ text: section.heading, x: cursor.left, y: baseline, size: style.headingSize, bold: true });
      const ruleY = baseline + DESCENT * style.headingSize + style.ruleGap;
      cursor.rule(ruleY, Math.max(0.5, Math.min(0.8, style.bodySize * 0.085)));
      cursor.y = ruleY + style.afterRuleGap;
    } else if (!firstSection) {
      cursor.gap(style.sectionGap);
    }
    firstSection = false;
    section.blocks.forEach((block, i) => {
      if (i > 0) {
        const tight = block.kind === "competency" && section.blocks[i - 1].kind === "competency";
        cursor.gap(tight ? style.itemGap : style.blockGap);
      }
      emitBlock(cursor, block, style, measure);
    });
  }

  return { pages: cursor.pages, pageWidth: style.pageWidth, pageHeight: style.pageHeight, marginX: style.marginLeft };
}

export interface ResumeFit {
  layout: ResumeLayout;
  style: ResumeStyle;
  /** Pages the fit aimed for: the original's count, or the fewest the floor allows. */
  targetPages: number;
  /** The layout reached `targetPages`. */
  fits: boolean;
}

/**
 * Lays the résumé out in as few pages as `targetPages` (the original's
 * count) allows, compressing `base` only as far as it must. With no target
 * it aims for the fewest pages the floor allows. When even the floor can't
 * reach the target, it takes the extra page with as little compression as
 * that page count needs (usually none) and reports `fits: false`.
 */
export function fitResumeLayout(
  doc: ParsedResumeDocument,
  measure: TextMeasurer,
  base: ResumeStyle,
  opts: { targetPages?: number | null; floorBodySize: number; marginFloor?: number | null },
): ResumeFit {
  const marginFloor = opts.marginFloor ?? null;
  const top = maxCompression(marginFloor);
  const at = (t: number) => {
    const style = compressResumeStyle(base, t, opts.floorBodySize, marginFloor);
    return { style, layout: layoutResumeDocument(doc, measure, style) };
  };
  const loosest = at(0);
  const tightest = at(top);
  const reachable = tightest.layout.pages.length;
  const wanted = opts.targetPages && opts.targetPages > 0 ? opts.targetPages : reachable;
  const goal = Math.max(wanted, reachable);
  if (loosest.layout.pages.length <= goal) return { ...loosest, targetPages: wanted, fits: loosest.layout.pages.length <= wanted };
  let lo = 0;
  let hi = top;
  let best = tightest;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const attempt = at(mid);
    if (attempt.layout.pages.length <= goal) {
      best = attempt;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return { ...best, targetPages: wanted, fits: best.layout.pages.length <= wanted };
}

/** A bullet a one-page fit left out, and the entry it came from as printed ("Marketing Manager | Brightline SaaS"). */
export interface LeftOutBullet {
  entry: string;
  text: string;
}

export interface OnePageFit extends ResumeFit {
  /** What was printed: `doc` less `leftOut`. */
  doc: ParsedResumeDocument;
  /** In document order; empty when everything fit. */
  leftOut: LeftOutBullet[];
}

interface BulletRef {
  section: number;
  block: number;
  bullet: number;
  entry: string;
  text: string;
  score: number;
}

/** Lower-cased words of three letters or more, for matching a bullet against the role's words. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]{3,}/gu)?.filter((w) => w.length >= 3) ?? [];
}

/**
 * The bullets a one-page fit may leave out, least important first. An
 * entry's first bullet is never a candidate (a role with no bullets reads
 * as a mistake). Among the rest, a bullet that uses the role's words
 * outranks one that doesn't; then newer entries outrank older ones (résumés
 * list the newest first), and earlier bullets outrank later ones.
 */
export function bulletsToLeaveOut(doc: ParsedResumeDocument, roleTerms: readonly string[] = []): BulletRef[] {
  const terms = new Set(roleTerms.map((t) => t.toLowerCase()).filter((t) => t.length >= 3));
  const hits = (text: string) => {
    let n = 0;
    for (const w of new Set(wordsOf(text))) {
      if (terms.has(w) || [...terms].some((t) => t.length >= 5 && (w.startsWith(t) || t.startsWith(w)) && Math.min(t.length, w.length) >= 5)) n++;
    }
    return Math.min(n, 4) / 4;
  };
  const refs: BulletRef[] = [];
  doc.sections.forEach((section, s) => {
    const entries = section.blocks.map((block, b) => ({ block, b })).filter(({ block }) => block.kind === "entry");
    entries.forEach(({ block, b }, order) => {
      if (block.kind !== "entry") return;
      const age = entries.length > 1 ? order / (entries.length - 1) : 0;
      block.bullets.forEach((text, i) => {
        if (i === 0) return;
        const later = block.bullets.length > 1 ? i / (block.bullets.length - 1) : 0;
        refs.push({ section: s, block: b, bullet: i, entry: block.title, text, score: 3 * hits(text) - 1.5 * age - 0.5 * later });
      });
    });
  });
  // Least important first; on a tie, the one further down the page.
  return refs.sort((a, b) => a.score - b.score || b.section - a.section || b.block - a.block || b.bullet - a.bullet);
}

function withoutBullets(doc: ParsedResumeDocument, out: Set<string>): ParsedResumeDocument {
  return {
    ...doc,
    sections: doc.sections.map((section, s) => ({
      ...section,
      blocks: section.blocks.map((block, b) =>
        block.kind === "entry" ? { ...block, bullets: block.bullets.filter((_, i) => !out.has(`${s}:${b}:${i}`)) } : block,
      ),
    })),
  };
}

/**
 * One page, whatever the original's length: the tightest fit
 * `fitResumeLayout` can make with the borders free to close in, and when
 * even that runs over, the fewest least-important bullets left out
 * (`bulletsToLeaveOut`) for it to fit. If it can't fit with every
 * candidate out, nothing is left out and it takes the pages it needs
 * (`fits: false`): a person gets their whole résumé rather than one stripped
 * to its first bullets.
 */
export function fitResumeOnOnePage(
  doc: ParsedResumeDocument,
  measure: TextMeasurer,
  base: ResumeStyle,
  opts: { floorBodySize: number; marginFloor?: number; roleTerms?: readonly string[] },
): OnePageFit {
  const marginFloor = opts.marginFloor ?? ONE_PAGE_MARGIN_FLOOR;
  const fitOpts = { targetPages: 1, floorBodySize: opts.floorBodySize, marginFloor };
  const whole = fitResumeLayout(doc, measure, base, fitOpts);
  if (whole.fits) return { ...whole, doc, leftOut: [] };
  const tightest = compressResumeStyle(base, maxCompression(marginFloor), opts.floorBodySize, marginFloor);
  const candidates = bulletsToLeaveOut(doc, opts.roleTerms);
  const out = new Set<string>();
  for (const ref of candidates) {
    out.add(`${ref.section}:${ref.block}:${ref.bullet}`);
    const trimmed = withoutBullets(doc, out);
    if (layoutResumeDocument(trimmed, measure, tightest).pages.length > 1) continue;
    const leftOut = candidates
      .filter((c) => out.has(`${c.section}:${c.block}:${c.bullet}`))
      .sort((a, b) => a.section - b.section || a.block - b.block || a.bullet - b.bullet)
      .map(({ entry, text }) => ({ entry, text }));
    return { ...fitResumeLayout(trimmed, measure, base, fitOpts), doc: trimmed, leftOut };
  }
  return { ...whole, doc, leftOut: [] };
}

/* ---------------------------------- fonts ---------------------------------- */

/** Base64 TrueType files for the regular and bold weights of one family. */
export interface ResumeFontFiles {
  regular: string;
  bold: string;
}

/** The characters the built-in fonts' WinAnsi encoding can print beyond Latin-1. */
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

function isWinAnsi(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || code === 0x09 || code === 0x0a || WINANSI_EXTRA.has(ch);
}

function documentText(doc: ParsedResumeDocument): string {
  const parts: string[] = [doc.name ?? "", doc.contactLine ?? ""];
  for (const section of doc.sections) {
    parts.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === "paragraph") parts.push(block.text);
      else if (block.kind === "competency") parts.push(block.category, block.items);
      else if (block.kind === "bullets") parts.push(...block.items);
      else parts.push(block.title, block.dateRight ?? "", ...block.bullets);
    }
  }
  return parts.join("\n");
}

/** Whether printing `doc` needs an embedded Unicode font (a "→", a "ł", Cyrillic). */
export function resumeNeedsUnicodeFont(doc: ParsedResumeDocument): boolean {
  for (const ch of documentText(doc)) if (!isWinAnsi(ch)) return true;
  return false;
}

const SPELLED_OUT: Record<string, string> = {
  "→": "->", "⟶": "->", "⇒": "=>", "←": "<-", "↔": "<->", "↑": "^", "↓": "v",
  "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~", "−": "-", "‐": "-", "‑": "-", "‒": "-", "―": "—",
  "′": "'", "″": '"', "✓": "", "✔": "", "★": "*", "☆": "*", "■": "•", "▪": "•", "●": "•", "◦": "•", "‣": "•",
  "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ı": "i", "ħ": "h", "Ħ": "H",
};

/** Spells a character the built-in fonts can't print as one they can, or drops it. */
function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    if (isWinAnsi(ch)) {
      out += ch;
      continue;
    }
    if (ch in SPELLED_OUT) {
      out += SPELLED_OUT[ch];
      continue;
    }
    const stripped = ch.normalize("NFD").replace(/\p{M}+/gu, "");
    out += [...stripped].every(isWinAnsi) ? stripped : "";
  }
  return out;
}

function mapDocumentText(doc: ParsedResumeDocument, fn: (s: string) => string): ParsedResumeDocument {
  return {
    name: doc.name === null ? null : fn(doc.name),
    contactLine: doc.contactLine === null ? null : fn(doc.contactLine),
    sections: doc.sections.map((section) => ({
      heading: fn(section.heading),
      blocks: section.blocks.map((block): ParsedResumeBlock => {
        switch (block.kind) {
          case "paragraph":
            return { kind: "paragraph", text: fn(block.text) };
          case "competency":
            return { kind: "competency", category: fn(block.category), items: fn(block.items) };
          case "bullets":
            return { kind: "bullets", items: block.items.map(fn) };
          case "entry":
            return { kind: "entry", title: fn(block.title), dateRight: block.dateRight === null ? null : fn(block.dateRight), bullets: block.bullets.map(fn) };
        }
      }),
    })),
  };
}

export function jsPdfMeasurer(doc: jsPDF, fontName: string = "helvetica"): TextMeasurer {
  const cache = new Map<string, number>();
  return {
    widthOf(text, size, bold) {
      const key = `${bold ? 1 : 0}|${text}`;
      let unit = cache.get(key);
      if (unit === undefined) {
        doc.setFont(fontName, bold ? "bold" : "normal");
        doc.setFontSize(1000);
        unit = doc.getTextWidth(text) / 1000;
        cache.set(key, unit);
      }
      return unit * size;
    },
  };
}

export interface RenderResumeOptions {
  /** The measured layout of the person's original résumé, when this device has it. */
  profile?: ResumeLayoutProfile | null;
  /** Unicode font files for the profile's family; needed only when `resumeNeedsUnicodeFont`. */
  fonts?: ResumeFontFiles | null;
  /** Always one page (a résumé tailored to a role), not the original's page count. */
  onePage?: boolean;
  /** The role's words (title, skills, posting), so a one-page fit keeps the bullets that use them. */
  roleTerms?: readonly string[];
}

export interface ResumePdfResult {
  bytes: ArrayBuffer;
  pages: number;
  /** The original's page count, when the layout came from it. */
  originalPages: number | null;
  /** The body type size the fit settled on. */
  bodySize: number;
  /** Reached the page count it aimed for: one page when `onePage`, else the original's (always true without one). */
  fits: boolean;
  onePage: boolean;
  /** Bullets a one-page fit left out, in document order. */
  leftOut: LeftOutBullet[];
}

/** Thin I/O: a real jsPDF document drawing the fitted layout. Runs the same
 *  under Node and in the browser. */
export function renderResumePdf(content: ParsedResumeDocument, options: RenderResumeOptions = {}): ResumePdfResult {
  const profile = options.profile ?? null;
  const base = profile ? styleFromLayoutProfile(profile) : defaultResumeStyle();
  const doc = new jsPDF({ unit: "pt", format: [base.pageWidth, base.pageHeight], compress: true });

  let fontName = base.family === "serif" ? "times" : "helvetica";
  let printable = content;
  if (resumeNeedsUnicodeFont(content)) {
    if (options.fonts) {
      fontName = base.family === "serif" ? "ResumeSerif" : "ResumeSans";
      doc.addFileToVFS(`${fontName}-Regular.ttf`, options.fonts.regular);
      doc.addFont(`${fontName}-Regular.ttf`, fontName, "normal");
      doc.addFileToVFS(`${fontName}-Bold.ttf`, options.fonts.bold);
      doc.addFont(`${fontName}-Bold.ttf`, fontName, "bold");
    } else {
      printable = mapDocumentText(content, toWinAnsi);
    }
  }

  const measure = jsPdfMeasurer(doc, fontName);
  const onePage = !!options.onePage;
  const fit: ResumeFit & { leftOut: LeftOutBullet[] } = onePage
    ? fitResumeOnOnePage(printable, measure, base, { floorBodySize: floorBodySizeFor(base, !!profile, true), roleTerms: options.roleTerms })
    : { ...fitResumeLayout(printable, measure, base, { targetPages: profile?.pageCount ?? null, floorBodySize: floorBodySizeFor(base, !!profile) }), leftOut: [] };

  fit.layout.pages.forEach((page, i) => {
    if (i > 0) doc.addPage([base.pageWidth, base.pageHeight]);
    doc.setDrawColor(17, 17, 17);
    for (const rule of page.rules) {
      doc.setLineWidth(rule.width);
      doc.line(rule.x1, rule.y, rule.x2, rule.y);
    }
    doc.setFillColor(17, 17, 17);
    for (const dot of page.dots) doc.circle(dot.x, dot.y, dot.r, "F");
    doc.setTextColor(17, 17, 17);
    for (const t of page.texts) {
      doc.setFont(fontName, t.bold ? "bold" : "normal");
      doc.setFontSize(t.size);
      doc.text(t.text, t.x, t.y, { align: t.align });
    }
  });

  return {
    bytes: doc.output("arraybuffer") as ArrayBuffer,
    pages: fit.layout.pages.length,
    originalPages: profile?.pageCount ?? null,
    bodySize: Math.round(fit.style.bodySize * 100) / 100,
    fits: fit.fits,
    onePage,
    leftOut: fit.leftOut,
  };
}

// Re-exported for existing importers; new code imports it from
// pdf-filename.ts, which doesn't pull jsPDF into the importing bundle.
export { deriveResumePdfFilename } from "./pdf-filename";
