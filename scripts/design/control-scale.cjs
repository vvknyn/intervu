// Pure detector behind tests/unit/control-scale.test.ts: a Button / input /
// select / textarea / tab trigger / chip picks a step of the control scale
// (globals.css `.ctl-sm|md|lg`, or a `size` variant of the primitive) and never
// writes its own height or vertical padding, so controls that share a bar
// share a height. Escape hatch: a `control-scale-allow: <reason>` comment on
// the offending line or within ALLOW_WINDOW_LINES above it — no file list.
"use strict";
const { ALLOW_WINDOW_LINES } = require("./banned-classes.cjs");

// Opening tag of a control element (a textarea is multi-line: its height is its content).
const CONTROL_OPEN = /<(?:button|input|select|Button|Input|SelectTrigger|Tabs\w*Trigger|TabItem|Chip)\b/g;
// `buttonVariants(...)` / `chipVariants(...)` plus the strings / identifiers
// cn()'d after it — the class builders behind <Link> buttons and chip constants.
const VARIANT_CALL = /(?:button|chip)Variants\((?:[^()]|\([^()]*\))*\)(?:\s*,\s*(?:"[^"]*"|`[^`]*`|[\w.]+))*/g;
// h-*, min-h-*, max-h-*, py-*, pt-*, pb-* (any variant prefix): the height and
// vertical-padding classes that make a control's height its own.
const HAND_ROLLED = /(?<![\w-])(?:[\w-]+:)*(?:min-h|max-h|h|py|pt|pb)-(?:\d|\[|auto\b|full\b|px\b)[\w./%\]\[()-]*/g;
// A checkbox/radio/range is a glyph, not a scale control.
const GLYPH_INPUT = /\btype=["'{](?:checkbox|radio|range|hidden|file)/;

/** Blank comment content (keeping offsets and line breaks). Unlike the shared
 *  stripComments it skips string literals, so the `//` of an "https://…" prop
 *  is not mistaken for a comment that swallows the closing quote and `/>`. */
function blankComments(src) {
    const out = src.split("");
    const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '"' || c === "'" || c === "`") {
            const multiline = c === "`";
            for (i++; i < src.length && src[i] !== c && (multiline || src[i] !== "\n"); i++) if (src[i] === "\\") i++;
        } else if (c === "/" && src[i + 1] === "/") {
            const end = src.indexOf("\n", i);
            blank(i, end === -1 ? src.length : end);
            i = end === -1 ? src.length : end;
        } else if (c === "/" && src[i + 1] === "*") {
            const end = src.indexOf("*/", i + 2);
            blank(i, end === -1 ? src.length : end + 2);
            i = end === -1 ? src.length : end + 1;
        }
    }
    return out.join("");
}

/** End index (exclusive) of the JSX opening tag starting at `start`: the first
 *  `>` outside `{...}` and outside string literals. */
function tagEnd(src, start) {
    let depth = 0;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (c === '"' || c === "'" || c === "`") {
            for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
        } else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0 && src[i - 1] !== "=") return i + 1;
    }
    return src.length;
}

function spans(src) {
    const out = [];
    for (const m of src.matchAll(CONTROL_OPEN)) {
        const end = tagEnd(src, m.index);
        if (!GLYPH_INPUT.test(src.slice(m.index, end))) out.push([m.index, end]);
    }
    for (const m of src.matchAll(VARIANT_CALL)) out.push([m.index, m.index + m[0].length]);
    return out;
}

/** `[{ line (1-based), token }]` for every hand-rolled height on a control. */
function findHandRolledControlHeights(raw) {
    const rawLines = raw.split("\n");
    const src = blankComments(raw);
    const out = [];
    for (const [a, b] of spans(src)) {
        for (const h of src.slice(a, b).matchAll(HAND_ROLLED)) {
            if (h[0].startsWith("file:")) continue; // the UA file-picker button inside an <input type=file>
            const line = src.slice(0, a + h.index).split("\n").length - 1;
            const from = Math.max(0, line - ALLOW_WINDOW_LINES + 1);
            if (!rawLines.slice(from, line + 1).some((l) => /control-scale-allow/.test(l))) out.push({ line: line + 1, token: h[0] });
        }
    }
    return out;
}

module.exports = { findHandRolledControlHeights, controlSpans: (raw) => spans(blankComments(raw)), blankComments, tagEnd };
