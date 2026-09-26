/**
 * `locationSummary`: a second cleanup pass over a location STRING (usually
 * `locationText(job)`'s own output — see job.ts) that removes the specific
 * class of upstream noise `locationText` doesn't touch: a trailing postal
 * code, an ATS breadcrumb chain with more levels than a reader needs, and a
 * per-state "Remote - XX" list enumerating every US state a role is remote
 * in.
 *
 * Live examples that motivated this (audit, 2026-08-20):
 *   "Waterloo, Ontario, CAN, N2L 0A1"
 *     -> "Waterloo, Ontario, CAN"                     (postal code stripped)
 *   "Toronto, ON, CAN, AMER - Canada - British Columbia - Vancouver - Bentall Centre"
 *     -> "Toronto +7 more"                              (breadcrumb dump too long to show whole)
 *   "Remote - AZ; Remote - AR; Remote - CA; …" (40 states)
 *     -> "Remote (US)"
 *
 * Every rule below is SHAPE-based (a regex over the string's structure), not
 * a lookup of specific place names — a rule that had to enumerate cities or
 * regions would only ever cover the examples it was written against.
 */
import { decodeText } from "@/lib/jobs/presentation";

/**
 * Trailing postal/zip code shapes worth stripping when they're the last
 * breadcrumb segment. Deliberately a short, generic pattern SET (not a
 * lookup table of country formats) — each entry matches a *shape*, not a
 * jurisdiction:
 *   - Canada: letter-digit-letter, digit-letter-digit ("N2L 0A1")
 *   - US: 5 digits, optionally +4 ("78701", "78701-1234")
 *   - UK: 1-2 letters, digit, optional letter/digit, digit, 2 letters
 *     ("SW1A 1AA", "M1 1AE")
 */
const POSTAL_CODE_PATTERNS: RegExp[] = [
  /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/, // CA
  /^\d{5}(-\d{4})?$/, // US
  /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}$/, // UK
];

function looksLikePostalCode(segment: string): boolean {
  return POSTAL_CODE_PATTERNS.some((re) => re.test(segment));
}

/** A raw location string's segment list splits on the two delimiters ATS
 *  breadcrumbs actually use: a comma-joined list ("Waterloo, Ontario, CAN")
 *  and a dash-joined hierarchy ("AMER - Canada - British Columbia"), often
 *  both in the same string. Splitting on both at once, rather than only the
 *  outermost one, is what turns a hybrid breadcrumb into one flat segment
 *  list the rest of this module can reason about uniformly. */
function splitSegments(s: string): string[] {
  return s
    .split(/\s*,\s*|\s+-\s+/)
    .map((seg) => seg.trim())
    .filter(Boolean);
}

/** Drops a segment that's an exact (case-insensitive) repeat of one already
 *  kept — the "later segments repeat earlier ones" half of the ATS-breadcrumb
 *  rule. A generic dedupe, not a per-place lookup: "Austin, Austin, TX" and
 *  "Toronto, Toronto, Ontario" collapse the same way. */
function dedupeRepeats(segments: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of segments) {
    const key = seg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seg);
  }
  return out;
}

/** "Remote - AZ; Remote - AR; …" — a semicolon-joined list of otherwise
 *  identical "Remote - <2-letter code>" entries. Matched by the SHAPE of the
 *  entry (a 2-letter code, not a specific enumerated list of state
 *  abbreviations), so it collapses whether the corpus lists 3 states or 40.
 *  The shape alone doesn't say WHICH country the codes belong to — see
 *  `remoteLabel` below, which decides that from two closed code tables. */
const REMOTE_STATE_ENTRY_RE = /^remote\s*-\s*([A-Za-z]{2})$/i;

/**
 * ANSI/USPS 2-letter codes for the 50 US states + DC + the 5 populated
 * territories. This is a fixed national standard (last changed when a
 * territory is added/removed, which is rare and would be a deliberate code
 * update, not open-ended data growth) — not a data enumeration the shape
 * regex above should have to guess at.
 */
const US_STATE_CODES: ReadonlySet<string> = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "AS", "GU", "MP", "PR", "VI",
]);

/** Canada Post's 2-letter codes for the 10 provinces + 3 territories — the
 *  other fixed standard `REMOTE_STATE_ENTRY_RE`'s shape can match. */
const CANADA_PROVINCE_CODES: ReadonlySet<string> = new Set([
  "ON", "BC", "AB", "QC", "MB", "SK", "NS", "NB", "NL", "PE", "NT", "YT", "NU",
]);

function isAllRemoteStateEntries(parts: string[]): boolean {
  return parts.length > 1 && parts.every((p) => REMOTE_STATE_ENTRY_RE.test(p));
}

/** Decides the "Remote (<country>)" label from the actual set of codes in the
 *  list — never from the shape match alone. All-US codes -> "Remote (US)";
 *  all-Canada codes -> plain "Remote"; anything else (a non-standard code,
 *  or a mix of the two tables) -> plain "Remote", since guessing a country
 *  from a shape that doesn't uniquely belong to one would just move the
 *  false-positive from "US" to whichever country was guessed. */
function remoteLabel(parts: string[]): string {
  const codes = parts.map((p) => REMOTE_STATE_ENTRY_RE.exec(p)![1]!.toUpperCase());
  if (codes.every((c) => US_STATE_CODES.has(c))) return "Remote (US)";
  if (codes.every((c) => CANADA_PROVINCE_CODES.has(c))) return "Remote";
  return "Remote";
}

/** A location value split into the part that identifies it and the part that
 *  merely places it — see `splitLocationLabel`. */
export interface LocationLabelParts {
  /** The identifying part. Never empty; the whole value when it is not a path. */
  lead: string;
  /** The broader levels above `lead`, in their original order. "" when none. */
  context: string;
}

/** Minimum "/"-joined levels before a value reads as a hierarchy path. Two
 *  segments are a compound name ("Frankfurt/Main") or a two-item list
 *  ("Middle East/Africa"), and reversing either would be wrong. */
const MIN_PATH_SEGMENTS = 3;

/**
 * Split a raw location value into what IDENTIFIES it and what merely places
 * it, for a one-line width-constrained row (the location typeahead).
 *
 * Measured on prod 2026-08-29, typing "North America":
 *
 *     North America/USA/Missouri/St. Louis - CCP    24
 *     North America/USA/Missouri/St. Louis - WPE    12
 *
 * Both rendered as `North America/USA/Missouri/St. …` — character-for-character
 * identical, two rows offering different things. CSS truncates from the end,
 * and the end is the only part that differs. Leading with the last segment
 * moves the discriminating token out of truncation's reach, which is how
 * place autocompletes render a hierarchy.
 *
 * Only "/" counts as a delimiter here, and only at three levels or more. The
 * other two delimiters this corpus uses are not reliably broad-to-narrow: a
 * spaced dash is narrow-first about as often as not ("Toronto - Bay St", also
 * measured on prod), and a comma list is conventionally narrow-first
 * ("Toronto, Ontario, Canada"). Reversing either would lead the row with the
 * wrong word. Anything that is not a path comes back whole, so a caller can
 * render every suggestion through this one shape.
 *
 * Display only. The caller still commits, compares and filters on the full
 * original value — that string is what the corpus and the facet hold.
 */
export function splitLocationLabel(raw: string): LocationLabelParts {
  const segments = raw.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.length < MIN_PATH_SEGMENTS) return { lead: raw, context: "" };
  return {
    lead: segments[segments.length - 1]!,
    context: segments.slice(0, -1).join(" / "),
  };
}

const MAX_SEGMENTS_BEFORE_SUMMARY = 3;

/**
 * See module doc above for the rule ladder and live examples. Order matters:
 * the remote-state-list check runs first because its own delimiter
 * (semicolon) and shape ("Remote - XX") would otherwise be misread as
 * breadcrumb segments by the comma/dash splitter below.
 */
export function locationSummary(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = decodeText(raw).trim();
  if (!s) return "";

  const semicolonParts = s.split(";").map((p) => p.trim()).filter(Boolean);
  if (isAllRemoteStateEntries(semicolonParts)) return remoteLabel(semicolonParts);
  // A single "Remote - XX" entry (no list) is already the compact shape this
  // rule exists to PRODUCE — left alone rather than run through the generic
  // dash-breadcrumb splitter below, which would reformat it to "Remote, XX".
  if (semicolonParts.length === 1 && REMOTE_STATE_ENTRY_RE.test(semicolonParts[0]!)) return semicolonParts[0]!;

  let segments = splitSegments(s);
  if (segments.length === 0) return s;

  if (looksLikePostalCode(segments[segments.length - 1]!)) {
    segments = segments.slice(0, -1);
  }
  segments = dedupeRepeats(segments);
  if (segments.length === 0) return s;

  if (segments.length > MAX_SEGMENTS_BEFORE_SUMMARY) {
    return `${segments[0]} +${segments.length - 1} more`;
  }
  return segments.join(", ");
}
