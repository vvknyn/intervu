/**
 * The single location normaliser. Every place a location LABEL is built
 * (`locationText`, `locationSummary`, `placeWithWorkMode`/`locationWithMode`,
 * the For-you chip and pack) routes its string through `normaliseLocation`
 * instead of carrying its own dedupe, so a boilerplate/duplicate shape fixed
 * here is fixed on every surface at once.
 *
 * Motivating live label: "RemoteRemote Location, All States · Remote" — an
 * ATS filler ("Remote Location", "All States") glued to the real value, then
 * the work mode appended a second time because the whole-segment comparison
 * saw "Remote Location" != "Remote".
 *
 * Every rule is SHAPE-based (a pattern over the string, never a list of
 * employers or places), and separators are preserved: a string none of the
 * rules touch comes back unchanged, so "Remote - EMEA" and "Canada · Remote"
 * keep their own glue.
 *
 * Leaf module (no imports): both `lib/jobs/presentation.ts` and
 * `lib/presentation/location.ts` depend on it, and they already depend on
 * each other.
 */

/**
 * ANSI/USPS 2-letter codes for the 50 US states + DC + the 5 populated
 * territories. A fixed national standard, not open-ended data.
 */
export const US_STATE_CODES: ReadonlySet<string> = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "AS", "GU", "MP", "PR", "VI",
]);

/** Canada Post's 2-letter codes for the 10 provinces + 3 territories. */
export const CANADA_PROVINCE_CODES: ReadonlySet<string> = new Set([
  "ON", "BC", "AB", "QC", "MB", "SK", "NS", "NB", "NL", "PE", "NT", "YT", "NU",
]);

/** Separators between segments of one location: comma, middle dot, spaced
 *  dash. Captured so the original glue survives. A bare hyphen is NOT one
 *  ("Winston-Salem", "Baden-Baden" are single places). */
const SEGMENT_SEPARATOR_RE = /(\s*[,·]\s*|\s+-\s+)/;

/** Whitespace-less join of one word with itself ("RemoteRemote"). Halves of
 *  4+ letters only, so a real short reduplication never matches. */
const GLUED_REPEAT_RE = /\b([A-Za-z]{4,})\1\b/gi;

/** A work-mode word repeated with spaces ("Remote Remote"). Scoped to the
 *  closed work-mode vocabulary so real reduplicated places ("Walla Walla",
 *  "Bora Bora") are untouched. */
const WORK_MODE_REPEAT_RE = /\b(remote|hybrid|on-?site)(?:\s+\1)+\b/gi;

/** "Remote" followed only by generic ATS filler nouns. */
const REMOTE_FILLER_RE = /^remote(?:[\s-]+(?:location|city|office|work|worker|position|role|job|based))+$/i;

/** A segment that names a field, not a value ("All States", "Location"). */
const PLACEHOLDER_RE =
  /^(?:(?:all|any|every)\s+(?:states?|cities|city|provinces?|regions?|locations?|countries)|location|city|state|province|region|country|n\/?a|tbd)$/i;

/** ATS site code: "<CC> <ST> <Name>" ("US CT Shelton", "US FL Remote"). */
const SITE_CODE_RE = /^[A-Z]{2}\s+([A-Z]{2})\s+([^,;]+)$/;

interface Segment {
  text: string;
  /** The separator that preceded this segment in the source. */
  sepBefore: string;
}

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** "US CT Shelton" -> "Shelton, CT"; "US FL Remote" -> "Remote - FL" (the
 *  compact shape `locationSummary` already collapses across a whole list). */
function rewriteSiteCode(entry: string): string {
  const m = SITE_CODE_RE.exec(entry.trim());
  if (!m) return entry;
  const [, state, name] = m as unknown as [string, string, string];
  if (!US_STATE_CODES.has(state) && !CANADA_PROVINCE_CODES.has(state)) return entry;
  return /^remote$/i.test(name.trim()) ? `Remote - ${state}` : `${name.trim()}, ${state}`;
}

function cleanSegmentText(text: string): string | null {
  const t = text.trim();
  if (!t || PLACEHOLDER_RE.test(t)) return null;
  return REMOTE_FILLER_RE.test(t) ? "Remote" : t;
}

function splitSegments(entry: string): Segment[] {
  const pieces = entry.split(SEGMENT_SEPARATOR_RE);
  const out: Segment[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    out.push({ text: pieces[i]!, sepBefore: i === 0 ? "" : pieces[i - 1]! });
  }
  return out;
}

/** Drops a segment whose tokens are a subset of another's ("Remote" inside
 *  "Remote Canada"); of two equal segments the earlier survives. */
function dropContained(segments: Segment[]): Segment[] {
  const toks = segments.map((s) => tokens(s.text));
  return segments.filter((_, i) => {
    if (toks[i]!.length === 0) return true;
    return !toks.some((other, j) => {
      if (j === i || toks[i]!.length > other.length) return false;
      if (!toks[i]!.every((t) => other.includes(t))) return false;
      return toks[i]!.length < other.length || j < i;
    });
  });
}

function joinSegments(segments: Segment[]): string {
  return segments.map((s, i) => (i === 0 ? s.text : s.sepBefore + s.text)).join("");
}

function normaliseEntry(entry: string): string {
  const segments = splitSegments(rewriteSiteCode(entry))
    .map((s) => ({ ...s, text: cleanSegmentText(s.text) }))
    .filter((s): s is Segment => s.text !== null);
  return joinSegments(dropContained(segments));
}

/** A location string's ";"-separated entries (an aggregator's multi-location
 *  list), trimmed, empties removed. A single location is a one-entry list. */
export function locationEntries(raw: string): string[] {
  return raw.split(";").map((e) => e.trim()).filter(Boolean);
}

/**
 * Normalise a raw or already-humanised location string: collapse glued and
 * repeated work-mode words, strip ATS boilerplate segments, rewrite site
 * codes, then dedupe by token containment inside each entry and by identity
 * across entries. Multi-location lists stay lists. "" when nothing real is
 * left — the caller decides its own fallback (never invented here).
 */
export function normaliseLocation(raw: string): string {
  const glued = raw.replace(GLUED_REPEAT_RE, "$1").replace(WORK_MODE_REPEAT_RE, "$1");
  const seen = new Set<string>();
  return locationEntries(glued)
    .map(normaliseEntry)
    .filter((entry) => {
      const key = tokens(entry).join(" ");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("; ");
}

/** Every segment of a place string, across ";" entries and all separators. */
export function placeSegments(place: string): string[] {
  return locationEntries(place).flatMap((e) => splitSegments(e).map((s) => s.text.trim()).filter(Boolean));
}

/** True when `place` carries `word` (case-insensitive) as a whole segment. */
export function placeHasSegment(place: string, word: string): boolean {
  const w = word.toLowerCase();
  return placeSegments(place).some((s) => s.toLowerCase() === w);
}

/** Remove every segment equal to `word` — for a surface that renders the
 *  work mode separately. Returns `place` unchanged when it has none. */
export function stripPlaceSegment(place: string, word: string): string {
  if (!placeHasSegment(place, word)) return place;
  const w = word.toLowerCase();
  return locationEntries(place)
    .map((e) => joinSegments(splitSegments(e).filter((s) => s.text.trim().toLowerCase() !== w)))
    .filter(Boolean)
    .join("; ");
}
