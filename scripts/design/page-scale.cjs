// Pure detector behind tests/unit/page-scale.test.ts — the page-level half of
// the design scales (the control half is control-scale.cjs):
//   container  a class string that centres a capped column with its own
//              gutter (`mx-auto` + `max-w-*` + non-zero `px-*`/`p-*`), or
//              centres the shell's width (`max-w-6xl|7xl`), instead of
//              <PageContainer> / `.shell-row` (the one width + gutter).
//   heading    an <h1>, <PageTitle>, <SectionTitle> or <SubTitle> that writes
//              its own text size (the component owns it), or an h2–h6 whose
//              size is off the heading scale (only xs / sm / base / xl).
//   prose      a bare `prose` class outside the <Prose> primitive.
// Escape hatch: a `page-scale-allow: <reason>` comment on the offending line
// or within ALLOW_WINDOW_LINES above it — no file list.
"use strict";
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { ALLOW_WINDOW_LINES } = require("./banned-classes.cjs");
const { blankComments, tagEnd } = require("./control-scale.cjs");

// A class token is whitespace/quote-delimited — so "@/components/ui/prose"
// (an import path) and `max-w-prose` / `prose-sm` are not the `prose` class.
const tok = (body) => new RegExp(`(?<![^\\s"'\`])(?:[\\w-]+:)*${body}(?![^\\s"'\`])`);
const STRING = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;
const MX_AUTO = tok("mx-auto");
const MAX_W = tok("max-w-[\\w.\\[\\]()%-]+");
const GUTTER = tok("(?:px|p|pl|pr|ps|pe)-(?!0(?![.\\d]))[\\w.\\[\\]()%-]+");
// The shell's own widths (72rem / 80rem): centring one is the shell row
// hand-rolled even when the gutter sits on a parent.
const SHELL_W = tok("max-w-(?:6xl|7xl)");
const PROSE = tok("prose");
const HEADING_OPEN = /<(h[1-6]|PageTitle|SectionTitle|SubTitle)\b/g;
// Font-size utilities: every `--text-*` theme token whose value is a length
// (globals.css is the one list, so a new size token is covered by
// construction; `--text-2: var(--muted-foreground)` is a colour, not a size),
// plus arbitrary lengths `text-[18px]` / `text-[clamp(...)]`.
const SIZE_NAMES = [...readFileSync(path.join(__dirname, "../../src/app/globals.css"), "utf8")
    .matchAll(/^\s*--text-([\w-]+):\s*(?:[\d.]+(?:rem|px|em)\b|clamp\()/gm)].map((m) => m[1]);
const SIZE = new RegExp(`(?<![\\w-])(?:[\\w-]+:)*text-(${SIZE_NAMES.join("|")}|\\[(?:length:|clamp\\(|\\d)[^\\]\\s]*\\])(?![\\w-])`, "g");
const SECTION_STEPS = new Set(["xs", "sm", "base", "xl"]);

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/** End (exclusive) of the string literal or `{...}` expression starting at `i`. */
function valueEnd(src, i) {
    let depth = 0;
    for (let k = i; k < src.length; k++) {
        const c = src[k];
        if (c === '"' || c === "'" || c === "`") {
            for (k++; k < src.length && src[k] !== c; k++) if (src[k] === "\\") k++;
            if (depth === 0) return k + 1;
        } else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) return k + 1;
    }
    return src.length;
}

/** Class units: each `className=` value whole (a `cn(...)` splits one
 *  container across strings and branches), plus every string literal outside
 *  one (class constants, `cn()` args built elsewhere). */
function classUnits(src) {
    const attrs = [...src.matchAll(/\bclassName=(?=["'`{])/g)].map((m) => {
        const start = m.index + m[0].length;
        return { index: start, text: src.slice(start, valueEnd(src, start)) };
    });
    const inAttr = (i) => attrs.some((a) => i >= a.index && i < a.index + a.text.length);
    const strings = [...src.matchAll(STRING)].filter((m) => !inAttr(m.index)).map((m) => ({ index: m.index, text: m[0] }));
    return [...attrs, ...strings];
}

function candidates(src) {
    const out = [];
    for (const { index, text } of classUnits(src)) {
        const at = (m) => index + text.slice(0, m.index).length;
        const mx = MX_AUTO.exec(text);
        if (mx && (GUTTER.test(text) || SHELL_W.test(text))) {
            const m = MAX_W.exec(text);
            if (m) out.push({ index: at(mx), rule: "container", token: m[0] });
        }
        for (const p of text.matchAll(new RegExp(PROSE, "g"))) out.push({ index: at(p), rule: "prose", token: p[0] });
    }
    for (const t of src.matchAll(HEADING_OPEN)) {
        const ownsSize = !/^h[2-6]$/.test(t[1]);
        for (const z of src.slice(t.index, tagEnd(src, t.index)).matchAll(SIZE)) {
            if (ownsSize || !SECTION_STEPS.has(z[1])) out.push({ index: t.index + z.index, rule: "heading", token: `<${t[1]}> ${z[0]}` });
        }
    }
    return out;
}

/** `[{ line (1-based), rule, token }]` for every hand-rolled page style. */
function findHandRolledPageStyles(raw) {
    const rawLines = raw.split("\n");
    const src = blankComments(raw);
    return candidates(src)
        .map((c) => ({ line: lineOf(src, c.index), rule: c.rule, token: c.token }))
        .filter(({ line }) => !rawLines.slice(Math.max(0, line - ALLOW_WINDOW_LINES), line).some((l) => /page-scale-allow:\s*\S/.test(l)))
        .sort((a, b) => a.line - b.line);
}

module.exports = { findHandRolledPageStyles };
