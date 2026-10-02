/**
 * The look of an uploaded PDF résumé, measured from its text positions, so a
 * tailored copy can be printed the way the person laid out the original:
 * same paper, margins, type sizes, line spacing, typeface family, alignment
 * and page count.
 *
 * Measured in the browser from the pdf.js text items the upload already
 * reads (`extractPDFTextInBrowser`), never from the file on a server, and
 * kept on this device only (`layout-profile-storage.ts`). Pure, so the
 * measuring rules run the same in unit tests.
 */

import { DATE_RANGE_RE } from "@/lib/resume/resume-dates";
import { resumeSectionOfHeading } from "@/lib/resume/structure-resume-text";

export interface ResumeLayoutProfile {
  version: 1;
  pageWidth: number;
  pageHeight: number;
  pageCount: number;
  /** Distance from each page edge to the nearest text, in points. */
  marginLeft: number;
  marginRight: number;
  /** Page top to the cap height of the first line. */
  marginTop: number;
  /** Page bottom to the descenders of the lowest line on a full page. */
  marginBottom: number;
  bodySize: number;
  /** Baseline-to-baseline distance inside a paragraph, as a multiple of `bodySize`. */
  lineHeight: number;
  nameSize: number;
  contactSize: number;
  headingSize: number;
  /** A role line's title ("Senior Nurse | St. Mary's") and its dates. */
  titleSize: number;
  dateSize: number;
  /** Left edge of a bullet's text, measured from the left margin. */
  bulletIndent: number;
  family: "sans" | "serif";
  /** Paragraph lines run flush to the right margin. */
  justified: boolean;
  /** The name and contact line are centred on the page. */
  centeredHeader: boolean;
}

/** The fields of a pdf.js `TextItem` this reads. */
export interface LayoutTextItem {
  str: string;
  /** [a, b, c, d, x, y]: x and y are the item's left edge and baseline (from the page bottom). */
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface LayoutPage {
  width: number;
  height: number;
  /** Bottom-left corner of the page box in PDF space (pdf.js `page.view`), when not [0, 0]. */
  origin?: [number, number];
  items: LayoutTextItem[];
  /** pdf.js `textContent.styles`: the font family pdf.js resolved for each font. */
  styles?: Record<string, { fontFamily?: string }>;
}

interface Line {
  text: string;
  left: number;
  right: number;
  /** Baseline, from the page bottom. */
  y: number;
  size: number;
  /** Characters set at `size`, for weighting. */
  chars: number;
  serifChars: number;
  page: number;
  /** Left edge of the text after a bullet glyph, when the line starts with one. */
  bulletTextLeft: number | null;
  /** Size of the text a date range sits in, when the line carries one. */
  dateSize: number | null;
  titleSize: number | null;
}

const BULLET_GLYPH_RE = /^[•●▪◦‣∙·⁃*–-]$/;
const BULLET_PREFIX_RE = /^[•●▪◦‣∙·]\s/;
/** Cap height and descender depth of a typical Latin face, as a fraction of its size. */
const CAP_HEIGHT = 0.72;
const DESCENT = 0.21;

function itemSize(item: LayoutTextItem): number {
  const [a, b, c, d] = item.transform;
  return item.height || Math.hypot(c ?? 0, d ?? 0) || Math.hypot(a ?? 0, b ?? 0);
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The most common value after rounding to `step`, weighted. */
function weightedMode(values: Array<[value: number, weight: number]>, step: number): number {
  const buckets = new Map<number, { weight: number; values: number[] }>();
  for (const [value, weight] of values) {
    const key = Math.round(value / step);
    const bucket = buckets.get(key) ?? { weight: 0, values: [] };
    bucket.weight += weight;
    bucket.values.push(value);
    buckets.set(key, bucket);
  }
  let best: { weight: number; values: number[] } | null = null;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  return best ? median(best.values) : NaN;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Groups a page's items into printed lines (a new baseline or pdf.js's own line end). */
function pageLines(page: LayoutPage, pageIndex: number): Line[] {
  const lines: Line[] = [];
  const [ox, oy] = page.origin ?? [0, 0];
  let parts: LayoutTextItem[] = [];
  const serif = (item: LayoutTextItem) => /serif/i.test(page.styles?.[item.fontName ?? ""]?.fontFamily ?? "") && !/sans/i.test(page.styles?.[item.fontName ?? ""]?.fontFamily ?? "");

  const finish = () => {
    const inked = parts.filter((p) => p.str.trim() !== "" && itemSize(p) > 0);
    parts = [];
    if (inked.length === 0) return;
    const text = inked.map((p) => p.str).join(" ").replace(/\s+/g, " ").trim();
    const sizeWeights: Array<[number, number]> = inked.map((p) => [itemSize(p), p.str.trim().length]);
    const size = weightedMode(sizeWeights, 0.05);
    const chars = inked.reduce((n, p) => n + p.str.trim().length, 0);
    const glyph = BULLET_GLYPH_RE.test(inked[0].str.trim()) && inked.length > 1;
    const bulletTextLeft = glyph ? inked[1].transform[4] - ox : null;
    let dateSize: number | null = null;
    let titleSize: number | null = null;
    if (DATE_RANGE_RE.test(text) && text.split(/\s+/).length <= 16) {
      const dated = inked.find((p) => DATE_RANGE_RE.test(p.str) || /\b(19|20)\d{2}\b/.test(p.str));
      if (dated && dated !== inked[0]) {
        dateSize = itemSize(dated);
        titleSize = itemSize(inked[0]);
      }
    }
    lines.push({
      text,
      left: Math.min(...inked.map((p) => p.transform[4])) - ox,
      right: Math.max(...inked.map((p) => p.transform[4] + p.width)) - ox,
      y: inked[0].transform[5] - oy,
      size,
      chars,
      serifChars: inked.filter(serif).reduce((n, p) => n + p.str.trim().length, 0),
      page: pageIndex,
      bulletTextLeft,
      dateSize,
      titleSize,
    });
  };

  for (const item of page.items) {
    if (typeof item.str !== "string") continue;
    const first = parts.find((p) => p.str.trim() !== "");
    if (first && item.str.trim() !== "") {
      const tolerance = Math.max(2, 0.5 * Math.max(itemSize(first), itemSize(item)));
      if (Math.abs(item.transform[5] - first.transform[5]) > tolerance) finish();
    }
    parts.push(item);
    if (item.hasEOL) finish();
  }
  finish();
  // Top of the page first, the way the page reads.
  return lines.sort((a, b) => b.y - a.y || a.left - b.left);
}

/**
 * Measures a PDF résumé's layout, or returns null when the pages carry too
 * little text to say (a scan, a one-line file).
 */
export function measureResumeLayout(pages: LayoutPage[]): ResumeLayoutProfile | null {
  if (pages.length === 0) return null;
  const { width: pageWidth, height: pageHeight } = pages[0];
  if (!(pageWidth > 100 && pageHeight > 100)) return null;
  const all = pages.flatMap((page, i) => pageLines(page, i));
  if (all.length < 8) return null;

  const bodySize = weightedMode(all.map((l) => [l.size, l.chars]), 0.1);
  if (!(bodySize > 4 && bodySize < 20)) return null;
  const isBody = (l: Line) => Math.abs(l.size - bodySize) <= Math.max(0.15, bodySize * 0.03);

  // Inside a paragraph lines sit one pitch apart; bullets and blocks add
  // space on top, so the most common gap between body lines is the pitch.
  // Printers round baselines, so one paragraph's gaps can alternate (9.75,
  // 10.5): average the tight cluster rather than picking one of them.
  const gaps: number[] = [];
  for (let i = 1; i < all.length; i++) {
    const prev = all[i - 1];
    const next = all[i];
    if (prev.page !== next.page || !isBody(prev) || !isBody(next)) continue;
    const gap = prev.y - next.y;
    if (gap >= bodySize * 0.95 && gap <= bodySize * 1.9) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const low = gaps[Math.floor(gaps.length * 0.2)];
  const cluster = gaps.filter((g) => g >= low * 0.97 && g <= low * 1.1);
  const pitch = cluster.length >= 3 ? cluster.reduce((a, b) => a + b, 0) / cluster.length : bodySize * 1.25;

  const firstPage = all.filter((l) => l.page === 0);
  const firstLine = firstPage[0];
  const headings = all.filter((l) => l.text.length <= 60 && resumeSectionOfHeading(l.text) !== null);
  const firstHeadingIndex = firstPage.findIndex((l) => headings.includes(l));
  const nameSize = firstLine && firstLine.size > bodySize * 1.15 ? firstLine.size : bodySize * 1.6;
  const headerLines = firstPage.slice(1, firstHeadingIndex > 0 ? firstHeadingIndex : Math.min(4, firstPage.length));
  const contactSizes = headerLines.filter((l) => l.size < nameSize - 0.5).map((l) => l.size);
  const contactSize = contactSizes.length > 0 ? median(contactSizes) : bodySize;
  const headingSize = headings.length > 0 ? median(headings.map((l) => l.size)) : bodySize * 1.05;
  const titled = all.filter((l) => l.titleSize !== null && l.dateSize !== null);
  const titleSize = titled.length > 0 ? median(titled.map((l) => l.titleSize!)) : bodySize;
  const dateSize = titled.length > 0 ? median(titled.map((l) => l.dateSize!)) : bodySize;

  const marginLeft = Math.min(...all.map((l) => l.left));
  const contentRight = Math.max(...all.map((l) => l.right));
  // Where paragraph text stops: a bold run or a date can poke past it.
  const bodyRights = all.filter(isBody).map((l) => l.right).sort((a, b) => a - b);
  const textRight = bodyRights.length > 0 ? bodyRights[Math.floor(bodyRights.length * 0.9)] : contentRight;
  let marginRight = pageWidth - contentRight;
  // A ragged page may never reach its right margin: assume the left one.
  if (marginRight > marginLeft + 18) marginRight = marginLeft;
  const marginTop = pageHeight - Math.max(...firstPage.map((l) => l.y + l.size * CAP_HEIGHT));
  // Only a page the text runs off shows where the bottom margin is.
  const fullPages = pages.slice(0, -1).map((_, i) => all.filter((l) => l.page === i));
  const bottoms = fullPages.filter((ls) => ls.length > 0).map((ls) => Math.min(...ls.map((l) => l.y - l.size * DESCENT)));
  const lastPageBottom = Math.min(...all.filter((l) => l.page === pages.length - 1).map((l) => l.y - l.size * DESCENT));
  const marginBottom = bottoms.length > 0 ? Math.min(...bottoms) : Math.min(marginTop, lastPageBottom);

  const bulletLefts = all.filter((l) => l.bulletTextLeft !== null).map((l) => l.bulletTextLeft! - marginLeft);
  const bulletIndent = bulletLefts.length > 0 ? median(bulletLefts) : bodySize * 1.45;

  // Justified: the full lines that a paragraph carries on from end flush
  // at the right margin; ragged ones stop wherever their last word did.
  let flush = 0;
  let carried = 0;
  for (let i = 1; i < all.length; i++) {
    const prev = all[i - 1];
    const next = all[i];
    if (prev.page !== next.page || !isBody(prev) || !isBody(next)) continue;
    if (Math.abs(prev.y - next.y - pitch) > Math.max(0.8, pitch * 0.08)) continue;
    if (BULLET_PREFIX_RE.test(next.text) || next.bulletTextLeft !== null) continue;
    if (next.left > prev.left + 1.5 && prev.bulletTextLeft === null) continue;
    if (prev.dateSize !== null) continue;
    const contentWidth = textRight - marginLeft;
    if (prev.right < textRight - contentWidth * 0.15) continue;
    carried += 1;
    if (Math.abs(prev.right - textRight) <= 2) flush += 1;
  }
  const justified = carried >= 3 && flush / carried >= 0.8;

  const serifChars = all.reduce((n, l) => n + l.serifChars, 0);
  const chars = all.reduce((n, l) => n + l.chars, 0);
  const centeredHeader = !!firstLine && Math.abs((firstLine.left + firstLine.right) / 2 - pageWidth / 2) < 12;

  return {
    version: 1,
    pageWidth: round2(pageWidth),
    pageHeight: round2(pageHeight),
    pageCount: pages.length,
    marginLeft: round2(clamp(marginLeft, 14, 108)),
    marginRight: round2(clamp(marginRight, 14, 108)),
    marginTop: round2(clamp(marginTop, 12, 108)),
    marginBottom: round2(clamp(marginBottom, 12, 108)),
    bodySize: round2(bodySize),
    lineHeight: round2(clamp(pitch / bodySize, 1.05, 1.8)),
    nameSize: round2(clamp(nameSize, bodySize, 36)),
    contactSize: round2(clamp(contactSize, bodySize * 0.75, bodySize * 1.3)),
    headingSize: round2(clamp(headingSize, bodySize * 0.9, bodySize * 2)),
    titleSize: round2(clamp(titleSize, bodySize * 0.9, bodySize * 1.6)),
    dateSize: round2(clamp(dateSize, bodySize * 0.8, bodySize * 1.3)),
    bulletIndent: round2(clamp(bulletIndent, 4, 36)),
    family: chars > 0 && serifChars / chars > 0.5 ? "serif" : "sans",
    justified,
    centeredHeader,
  };
}

/** Reads a stored profile back, refusing anything malformed or from another version. */
export function parseResumeLayoutProfile(value: unknown): ResumeLayoutProfile | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (p.version !== 1) return null;
  const numbers = ["pageWidth", "pageHeight", "pageCount", "marginLeft", "marginRight", "marginTop", "marginBottom", "bodySize", "lineHeight", "nameSize", "contactSize", "headingSize", "titleSize", "dateSize", "bulletIndent"];
  if (!numbers.every((k) => typeof p[k] === "number" && Number.isFinite(p[k] as number) && (p[k] as number) > 0)) return null;
  if (p.family !== "sans" && p.family !== "serif") return null;
  if (typeof p.justified !== "boolean" || typeof p.centeredHeader !== "boolean") return null;
  return p as unknown as ResumeLayoutProfile;
}
