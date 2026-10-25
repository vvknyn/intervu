// Pure decision for the dialog-primitive gate (tests/unit/dialog-primitive-gate.test.ts).
// A modal surface must be built on ui/dialog.tsx or ui/sheet.tsx, whose body scrolls
// between a fixed header and footer. No I/O: input is one file's source text.

export const EXEMPT_MARKER = "dialog-primitive-exempt:";
export const MIN_EXEMPT_REASON = 10;

const has = (line, re) => re.test(line);
const CLASS_TOKEN = (t) => new RegExp(`(?<![\\w-])${t}(?![\\w-])`);
const FIXED = CLASS_TOKEN("fixed");

/** Each rule: what a hand-rolled modal looks like on one line. `role="dialog"` inside a CSS selector (`[role="dialog"]`) is a query, not a declaration. */
const RULES = [
  { id: "role-dialog", test: (l) => has(l, /(?<![\[\w])role(=|:\s*)\{?\s*["']dialog["']/) },
  { id: "aria-modal", test: (l) => has(l, /(?<![\[\w])aria-modal\b/) },
  { id: "html-dialog", test: (l) => has(l, /<dialog[\s>]/) },
  {
    id: "radix-dialog-import",
    // The per-package path, vaul, or `Dialog` named out of the `radix-ui` umbrella (AlertDialog is its own primitive: ui/alert-dialog.tsx).
    test: (l) =>
      has(l, /from\s+["'](@radix-ui\/react-dialog|vaul)["']/) ||
      has(l, /import\s*\{[^}]*(?<![\w])Dialog\b[^}]*\}\s*from\s*["']radix-ui["']/),
  },
  { id: "fixed-full-viewport", test: (l) => has(l, FIXED) && has(l, CLASS_TOKEN("inset-0")) },
  {
    id: "fixed-centered",
    test: (l) => has(l, FIXED) && has(l, CLASS_TOKEN("top-1/2")) && has(l, CLASS_TOKEN("left-1/2")),
  },
];

/** A marker with a real reason on the offending line, or alone on the line directly above it. */
function exemptReason(line) {
  const at = line.indexOf(EXEMPT_MARKER);
  return at === -1 ? null : line.slice(at + EXEMPT_MARKER.length).replace(/\*\/|\}\s*$/g, "").trim();
}
const isExempt = (lines, i) =>
  [lines[i], lines[i - 1] ?? ""].some((l) => (exemptReason(l) ?? "").length >= MIN_EXEMPT_REASON);

/** source → [{ line, rule, text }] for every unexempted hand-rolled modal marker. */
export function findHandRolledOverlays(source) {
  const lines = source.split("\n");
  const hits = [];
  lines.forEach((text, i) => {
    if (has(text, /^\s*(\/\/|\*|\/\*)/) && exemptReason(text) === null) return; // prose comment
    const rule = RULES.find((r) => r.test(text));
    if (rule && !isExempt(lines, i)) hits.push({ line: i + 1, rule: rule.id, text: text.trim() });
  });
  return hits;
}
