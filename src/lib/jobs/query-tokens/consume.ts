/**
 * Shared by the typed-token parsers: a token inside a "quoted phrase" is part
 * of that phrase ("150k club"), never a filter, so a regex only ever sees the
 * text between quotes.
 */
export function replaceOutsideQuotes(
  q: string,
  re: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
): string {
  return q
    .split(/("[^"]*")/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(re, replacer as (m: string, ...a: unknown[]) => string)))
    .join("");
}

/** The residual query once a parser has cut tokens out: whitespace collapsed, orphaned commas dropped, ends trimmed. */
export const tidy = (q: string): string =>
  q
    .replace(/\s+/g, " ")
    .replace(/(?:\s*[,;])+(?=\s*[,;])/g, "")
    .replace(/^[\s,;]+|[\s,;]+$/g, "")
    .replace(/\s+([,;])/g, "$1");
