/**
 * Structural malformation checks for corpus location-facet values.
 *
 * These values are scraped and parsed upstream from employer-supplied text
 * (see `src/lib/geo/gazetteer.ts` and friends for the ingest side). Parsing
 * sometimes leaves an artifact behind rather than a place name — a
 * concatenation that dropped a token but kept its delimiter, a truncated
 * parenthetical, a raw table separator. Those artifacts are still real
 * corpus values (Meilisearch will facet-search and even filter on them), so
 * nothing upstream stops them from reaching the location typeahead. See
 * `src/lib/jobs/location-suggest.ts`, which is where this gates rendered
 * suggestions.
 *
 * Fail-safe by construction: every check below is POSITIVE evidence of a
 * parser artifact — unbalanced bracket delimiters, a raw markup/table
 * character, or whitespace collapsed around a dropped token. None of them
 * consult a gazetteer, a place-name list, or any per-place knowledge, so a
 * real place nobody has catalogued always clears every check here. Absence
 * of gazetteer knowledge is NOT evidence of malformation — only the string's
 * own shape is. A value that clears every check renders, even if this
 * module has never heard of it.
 */

/** Bracket-style delimiter pairs a well-formed value must balance. A few
 *  real place names legitimately carry a balanced parenthetical
 *  ("Korea (South)", "Congo (Kinshasa)") — only an UNBALANCED pair is
 *  positive evidence that upstream parsing truncated the value mid-token. */
const BRACKET_PAIRS: readonly [open: string, close: string][] = [
    ["(", ")"],
    ["[", "]"],
];

function countChar(value: string, ch: string): number {
    let n = 0;
    for (const c of value) if (c === ch) n++;
    return n;
}

function hasUnbalancedBrackets(value: string): boolean {
    return BRACKET_PAIRS.some(([open, close]) => countChar(value, open) !== countChar(value, close));
}

/**
 * Raw delimiter/markup characters that never occur in a real toponym in any
 * language. Their presence — regardless of where in the string — means an
 * upstream join or table delimiter leaked into the field verbatim (e.g. a
 * "<country> | <city>" concatenation collapsing two columns into one facet
 * value). This is a fixed character class, not a list of place names: it
 * fires identically on a delimiter artifact for any country, known or not.
 */
const RAW_DELIMITER_CHARS = /[|\\{}<>@#$%^*_=~`;]/;

/**
 * Two or more consecutive whitespace characters. A real geographic name —
 * including this corpus's own deliberate "<country> - <city>" compound tags
 * — always collapses to single spaces; a doubled space is what a dropped
 * token leaves behind between the separators that used to surround it.
 */
const COLLAPSED_WHITESPACE = /\s{2,}/;

/**
 * True when `value` shows positive, structural evidence of being a parser
 * artifact rather than a place name.
 *
 * Only ever a reason to HIDE a value, never a reason to trust one — a value
 * that returns `false` may still be nonsense (any ordinary word can), but
 * this module makes no claim either way about that. It only ever asserts
 * the positive: "this shape could not be a real place name."
 */
export function isMalformedLocationValue(value: string): boolean {
    return hasUnbalancedBrackets(value) || RAW_DELIMITER_CHARS.test(value) || COLLAPSED_WHITESPACE.test(value);
}
