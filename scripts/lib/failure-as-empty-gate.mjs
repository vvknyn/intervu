// Pure decision for the failure-as-empty gate (tests/unit/load-result.test.ts).
// Client code that reads the server must not turn a failed read into an empty
// value: that renders "nothing here" for a request that never answered (Sep 28:
// a 503 on the For-you action showed "No ranked roles to show right now.").
// Reads settle to `LoadResult` (src/lib/load-result.ts) and a failure renders
// `LoadFailedState`. No I/O: input is one file's source text.

export const EXEMPT_MARKER = "load-result-allow:";
export const MIN_EXEMPT_REASON = 10;

const EMPTY = String.raw`(?:\[\]|null|0)`;
const PATTERNS = [
  // .catch(() => [])  .catch(() => ({}))  .catch((e) => { cache = []; return cache; })
  new RegExp(
    String.raw`\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*(?:${EMPTY}|\(\s*\{\s*\}\s*\)|\{[^{}]*?(?:=\s*\[\]|return\s+(?:${EMPTY}|\{\s*\})\s*;?)[^{}]*\})\s*\)`,
    "g",
  ),
  // res.data ?? []  — an `{ error }` envelope read as an empty list
  /\.data\s*\?\?\s*\[\]/g,
];

const isClientModule = (source) => /^\s*["']use client["']/.test(source);

function exemptReason(line) {
  const at = line.indexOf(EXEMPT_MARKER);
  return at === -1 ? null : line.slice(at + EXEMPT_MARKER.length).replace(/\*\/|\}\s*$/g, "").trim();
}
const isExempt = (lines, i) =>
  [lines[i], lines[i - 1] ?? ""].some((l) => (exemptReason(l) ?? "").length >= MIN_EXEMPT_REASON);

/** source → [{ line, text }] for every unexempted failure-to-empty collapse in a "use client" module. */
export function findFailureAsEmpty(source) {
  if (!isClientModule(source)) return [];
  const lines = source.split("\n");
  const hits = [];
  for (const re of PATTERNS) {
    for (const m of source.matchAll(re)) {
      const i = source.slice(0, m.index).split("\n").length - 1;
      if (/^\s*(\/\/|\*|\/\*)/.test(lines[i])) continue; // prose comment
      if (!isExempt(lines, i)) hits.push({ line: i + 1, text: m[0].replace(/\s+/g, " ") });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}
