/**
 * Dependency-free casing helpers for display text.
 *
 * Lives at `lib/` root rather than under `lib/jobs` or `lib/geo` because both
 * layers need it and `lib/geo` must not depend on `lib/jobs` — the import
 * graph runs geo → jobs, never back.
 */

/**
 * Upper-case the first letter of each word, for labels built out of raw
 * identifiers and corpus values.
 *
 * Exists because the obvious spelling — `replace(/\b\w/g, ...)` — is wrong on
 * any word carrying a diacritic. JavaScript's `\w` is `[A-Za-z0-9_]`, ASCII
 * only, so `\b` fires INSIDE "Montréal" (between "é" and "a") and the label
 * renders "MontréAl". That shipped, and was visible on the location chip.
 *
 * The rule here is "capitalize a letter that follows a non-letter" rather
 * than "capitalize at a word boundary", which is what the `\b\w` spelling was
 * always reaching for. Separators (space, hyphen, "&", ".") still start a new
 * word, so "entry-level" → "Entry-Level" and "r&d" → "R&D" are unchanged;
 * apostrophes deliberately do NOT, so "john's" → "John's" instead of the
 * "John'S" the old spelling produced.
 *
 * Only the first letter is touched — the rest of each word is left exactly as
 * the corpus spelled it, so this can be pointed at values that are already
 * correctly cased without damaging them. For repairing scraped ALL-CAPS text,
 * where the whole word must be re-cased, use `titleCaseDisplay` instead.
 */
export function capitalizeWords(value: string): string {
    return value.replace(
        /(^|[^\p{L}\p{N}'])(\p{L})/gu,
        (_match, before: string, letter: string) => before + letter.toUpperCase(),
    );
}
