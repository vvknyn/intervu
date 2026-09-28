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
import { CANADA_PROVINCE_CODES, locationEntries, normaliseLocation, US_STATE_CODES } from "./location-normalise";

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

/** "Remote - AZ; Remote - AR; …" — a semicolon-joined list of otherwise
 *  identical "Remote - <2-letter code>" entries. Matched by the SHAPE of the
 *  entry (a 2-letter code, not a specific enumerated list of state
 *  abbreviations), so it collapses whether the corpus lists 3 states or 40.
 *  The shape alone doesn't say WHICH country the codes belong to — see
 *  `remoteLabel` below, which decides that from two closed code tables. */
const REMOTE_STATE_ENTRY_RE = /^remote\s*-\s*([A-Za-z]{2})$/i;

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

/** One ";"-entry's breadcrumb segments, trailing postal code removed. */
function entrySegments(entry: string): string[] {
  const segments = splitSegments(entry);
  return looksLikePostalCode(segments[segments.length - 1] ?? "") ? segments.slice(0, -1) : segments;
}

/**
 * See module doc above for the rule ladder and live examples. The string is
 * normalised first (`normaliseLocation`: boilerplate, glued/duplicate and
 * contained segments, site codes). Order then matters: the remote-state-list
 * check runs before the comma/dash splitter, which would misread its own
 * delimiter (semicolon) and shape ("Remote - XX") as breadcrumb segments.
 * A single breadcrumb over `MAX_SEGMENTS_BEFORE_SUMMARY` segments, or a
 * multi-location list over that many entries, is capped to "<first> +N more".
 */
export function locationSummary(raw: string | null | undefined): string {
  if (!raw) return "";
  const entries = locationEntries(normaliseLocation(decodeText(raw)));
  if (isAllRemoteStateEntries(entries)) return remoteLabel(entries);
  // A single "Remote - XX" entry (no list) is already the compact shape this
  // rule exists to PRODUCE — left alone rather than run through the generic
  // dash-breadcrumb splitter below, which would reformat it to "Remote, XX".
  if (entries.length === 1 && REMOTE_STATE_ENTRY_RE.test(entries[0]!)) return entries[0]!;

  const lists = entries.map(entrySegments).filter((l) => l.length > 0);
  if (lists.length === 0) return "";
  if (lists.length === 1) {
    const segments = lists[0]!;
    return segments.length > MAX_SEGMENTS_BEFORE_SUMMARY
      ? `${segments[0]} +${segments.length - 1} more`
      : segments.join(", ");
  }
  const places = lists.map((l) => l.join(", "));
  return places.length > MAX_SEGMENTS_BEFORE_SUMMARY
    ? `${places[0]} +${places.length - 1} more`
    : places.join("; ");
}
