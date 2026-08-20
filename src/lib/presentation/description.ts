/**
 * `descriptionLede`: a clean first ~200 chars of a job description for
 * previews (SERP row snippets, email digest bodies) — the audience
 * `formatDescription` (format-description.ts) doesn't serve, since that
 * function builds the FULL structured detail-pane render (headings, lists),
 * not a short plain-text lede.
 *
 * Live example that motivated this (audit, 2026-08-20):
 *   "Job Requisition ID #26WD99545 English posting follows. We are looking
 *    for a talented..."
 *     -> "We are looking for a talented..."
 *
 * Both stripped patterns are ATS/workflow BOILERPLATE shapes, not prose
 * about the role — matched generically by structure (a requisition-ID
 * header, a bilingual-posting marker sentence), never by company or listing.
 */
import { decodeText } from "@/lib/jobs/presentation";
import { stripResidualHtml } from "@/lib/jobs/format-description";

/**
 * A leading requisition/req-ID header: an optional "Job"/"Requisition"
 * label, an optional "ID"/"No"/"Number"/"#" qualifier, then the code itself
 * (letters+digits, e.g. "26WD99545", "R-123456", "98765"). Matches
 * "Job Requisition ID #26WD99545", "Req ID: R123456", "Requisition Number
 * 98765" alike — the shape is "a req-shaped label followed by a code", not
 * any one literal header string.
 */
const REQUISITION_HEADER_RE =
  /^\s*(job\s+)?req(?:uisition)?\.?\s*(?:id|no\.?|number|#)?\s*[:#]?\s*[a-z0-9][a-z0-9-]{2,}\.?\s*/i;

/**
 * A bilingual-posting marker sentence: "<word> posting/version/text
 * follows/is below/appears below." The leading word is unconstrained (not a
 * hardcoded language list) so this covers "English posting follows.",
 * "French version follows.", or any other language an ATS names, by shape
 * alone.
 */
const LOCALE_MARKER_RE = /^\s*(the\s+)?[a-z]+\s+(posting|version|text)\s+(follows|is\s+below|appears\s+below)\.?\s*/i;

const MAX_LEDE_LEN = 200;

/** Strips whichever boilerplate patterns match, repeatedly — a requisition
 *  header and a locale marker commonly stack ("Job Requisition ID #X English
 *  posting follows."), and either can lead. */
function stripBoilerplateOpeners(text: string): string {
  let out = text;
  let prev: string;
  do {
    prev = out;
    out = out.replace(REQUISITION_HEADER_RE, "").replace(LOCALE_MARKER_RE, "").trimStart();
  } while (out !== prev && out.length > 0);
  return out;
}

/** Truncates at the last word boundary within `maxLen`, so a preview never
 *  cuts mid-word — falls back to a hard cut only when no reasonable word
 *  boundary exists in the tail. */
function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  const boundary = lastSpace > maxLen * 0.6 ? lastSpace : maxLen;
  return `${cut.slice(0, boundary).trimEnd()}…`;
}

export function descriptionLede(raw: string | null | undefined, maxLen: number = MAX_LEDE_LEN): string {
  if (!raw) return "";
  const text = stripResidualHtml(decodeText(raw)).replace(/\s+/g, " ").trim();
  const clean = stripBoilerplateOpeners(text);
  return truncateAtWord(clean, maxLen);
}
