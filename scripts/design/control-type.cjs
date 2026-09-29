// Pure detector behind tests/unit/control-type.test.ts: a button's type (text
// size, weight) and corner come from its control step, never from its call
// site. The step→type mapping lives in ONE place, globals.css
// (`--control-text-sm|md|lg` beside `--control-h-sm|md|lg`, set per step by
// `.ctl-sm|md|lg` and painted by `.ctl-button`): 24px → 12px, 32px → 14px,
// 44px → 16px, all at weight 500, all on the control corner. The Button
// primitive's size variants consume it; a raw <button> on a step consumes it
// through `.ctl-button`. The 44px step is for fields and the /jobs Search
// submit only, so a button on it has to say why.
//
// What is flagged, on a <Button>, on `buttonVariants(...)` plus the classes
// cn()'d after it, on a raw <button> / <a> / <Link> / role="button" element
// that carries a `ctl-*` step class, and on any element that carries
// `.ctl-button` (a Radix trigger, a chip-shaped button):
//   - a text size (`text-xs|sm|base|lg|…`, the theme's named sizes, `text-[…]`
//     unless the arbitrary value is a colour),
//   - a font weight (`font-normal|medium|semibold|bold|…`, `font-[500]`),
//   - a corner (`rounded`, `rounded-*`),
//   - the 44px step (`size="lg"`, `size="icon-lg"`, `ctl-lg`),
//   - and, on a raw element only, a step without `.ctl-button` (its type would
//     be whatever it inherits).
// Text COLOUR classes are fine. Escape hatch: a `control-type-allow: <reason>`
// comment on the offending line or within ALLOW_WINDOW_LINES above it — no
// file list.
"use strict";
const { ALLOW_WINDOW_LINES } = require("./banned-classes.cjs");
const { blankComments, tagEnd } = require("./control-scale.cjs");

// The theme's text SIZE names (globals.css @theme `--text-*`): Tailwind's ramp
// plus the role names. Colour tokens never collide with these.
const SIZE_NAMES = "xs|sm|base|lg|xl|[2-9]xl|display|poster-hero|title|title-sm|title-lg|body|body-sm|meta|caption|headline";
const TEXT_SIZE = new RegExp(`^text-(?:(?:${SIZE_NAMES})(?:/\\S+)?|\\[(?!#|rgba?\\(|hsla?\\(|oklch\\(|oklab\\(|color:|var\\(--color-)[^\\]]+\\](?:/\\S+)?|\\(length:[^)]+\\))$`);
const FONT_WEIGHT = /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[(?:\d|weight:|var\(--font-weight)[^\]]*\]|\(weight:[^)]+\))$/;
const CORNER = /^rounded(?:-\S+)?$/;
const STEP = /^ctl-(?:sm|md|lg)$/;
const LG_CLASS = /^ctl-lg$/;
// `size="lg"`, `size={"icon-lg"}`, `size: "lg"` (buttonVariants options).
const LG_SIZE_PROP = /\bsize\s*(?:=\s*\{\s*(["'`])(?:icon-)?lg\1\s*\}|=\s*(["'`])(?:icon-)?lg\2|:\s*(["'`])(?:icon-)?lg\3)/g;
// The marker names its reason: a word, then some.
const ALLOW = /control-type-allow:\s*[A-Za-z][^*\n]{9,}/;

// `<Button` (not `<ButtonGroup`); raw elements are checked only when they sit on a step.
const BUTTON_OPEN = /<Button\b(?![\w.])/g;
const ANY_OPEN = /<([A-Za-z][\w.]*)\b/g;
const RAW_BUTTONISH = /^(?:button|a|Link)$/;
const ROLE_BUTTON = /\brole\s*=\s*\{?\s*["'`]button["'`]/;
// A <button> whose role makes it another control (a switch track, a tab, a
// select trigger, a menu item) takes that control's recipe, not a button face.
const OTHER_ROLE = /\brole\s*=\s*\{?\s*["'`](?:switch|tab|checkbox|radio|combobox|option|menuitem\w*|slider)["'`]/;
// `buttonVariants(...)` plus the strings / identifiers cn()'d after it.
const VARIANT_CALL = /\bbuttonVariants\((?:[^()]|\([^()]*\))*\)(?:\s*,\s*(?:"[^"]*"|`[^`]*`|'[^']*'|[\w.]+))*/g;

/** Class-like tokens of a span with their offsets: runs between whitespace,
 *  quotes, braces, parens and commas. */
function* tokens(text) {
    for (const m of text.matchAll(/[^\s"'`{}(),?;<>]+/g)) yield m;
}

/** The utility a token applies once its variant prefixes (`sm:`, `hover:`,
 *  `[&_svg]:`, `data-[state=open]:`) and `!` are stripped. */
function baseUtility(token) {
    let depth = 0;
    let cut = 0;
    for (let i = 0; i < token.length; i++) {
        const c = token[i];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ":" && depth === 0) cut = i + 1;
    }
    return token.slice(cut).replace(/^!|!$/g, "");
}

function classify(utility) {
    if (TEXT_SIZE.test(utility)) return "text size";
    if (FONT_WEIGHT.test(utility)) return "font weight";
    if (CORNER.test(utility)) return "corner";
    return null;
}

// `[export] const NAME = "…"` / `` const NAME = `…` `` — a class string kept in a constant.
const CLASS_CONST = /(\bexport\s+)?\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*("[^"\n]*"|'[^'\n]*'|`[^`]*`)/g;

/**
 * Named class strings that carry a control step or the button face:
 * `Map<name, { step, face }>`. Across files (`exportedOnly`, e.g. every file
 * under src) only exported constants count, so two files' local names cannot
 * collide. A constant that interpolates another (`${toolbarControlHeight}`)
 * inherits it. Lets a raw <button> whose step comes from a shared constant be
 * checked like one that spells the class out.
 */
function collectClassConstants(sources, exportedOnly = true) {
    const values = new Map();
    for (const raw of sources) {
        for (const m of blankComments(raw).matchAll(CLASS_CONST)) if (m[1] || !exportedOnly) values.set(m[2], [...tokens(m[3])].map((t) => baseUtility(t[0])));
    }
    const out = new Map();
    for (let pass = 0; pass < 3; pass++) {
        for (const [name, utilities] of values) {
            const via = utilities.map((u) => out.get(u)).filter(Boolean);
            const step = utilities.some((u) => STEP.test(u)) || via.some((v) => v.step);
            const face = utilities.includes("ctl-button") || via.some((v) => v.face);
            if (step || face) out.set(name, { step, face });
        }
    }
    return out;
}

/** `[{ kind: "button" | "raw", start, end }]` — the spans a button's classes live in. */
function spans(src, constants) {
    const out = [];
    for (const m of src.matchAll(BUTTON_OPEN)) out.push({ kind: "button", start: m.index, end: tagEnd(src, m.index) });
    for (const m of src.matchAll(VARIANT_CALL)) out.push({ kind: "button", start: m.index, end: m.index + m[0].length });
    for (const m of src.matchAll(ANY_OPEN)) {
        if (m[1] === "Button") continue; // its own span above
        const end = tagEnd(src, m.index);
        const tag = src.slice(m.index, end);
        if (OTHER_ROLE.test(tag) || /\bbuttonVariants\(/.test(tag)) continue; // another control / the call is its own span
        const utilities = [...tokens(tag)].map((t) => baseUtility(t[0]));
        const face = utilities.some((u) => u === "ctl-button" || constants.get(u)?.face);
        const step = utilities.some((u) => STEP.test(u) || constants.get(u)?.step);
        const buttonish = RAW_BUTTONISH.test(m[1]) || ROLE_BUTTON.test(tag);
        // An element that paints the button face is a button, whatever its tag
        // (a Radix trigger, a chip-shaped <button> built from chipVariants).
        if (face || (buttonish && step)) out.push({ kind: "raw", start: m.index, end });
    }
    // A class constant that paints the button face is button-only by declaration.
    for (const m of src.matchAll(CLASS_CONST)) {
        const start = m.index + m[0].length - m[3].length;
        if ([...tokens(m[3])].some((t) => baseUtility(t[0]) === "ctl-button")) out.push({ kind: "const", start, end: start + m[3].length });
    }
    return out;
}

/**
 * `[{ line (1-based), token, why }]` for every call-site override of a
 * button's type, corner or step. `constants` (from collectClassConstants over
 * the whole tree) resolves a step or face that a tag names through a shared
 * constant; the file's own constants are always read.
 */
function findControlTypeOverrides(raw, constants = new Map()) {
    const rawLines = raw.split("\n");
    const src = blankComments(raw);
    const known = new Map([...constants, ...collectClassConstants([raw], false)]);
    const lineOf = (offset) => src.slice(0, offset).split("\n").length - 1;
    const allowed = (line) => rawLines.slice(Math.max(0, line - ALLOW_WINDOW_LINES + 1), line + 1).some((l) => ALLOW.test(l));
    const out = [];
    const seen = new Set();
    const flag = (offset, token, why) => {
        const line = lineOf(offset);
        const key = `${offset}:${token}`;
        if (seen.has(key) || allowed(line)) return;
        seen.add(key);
        out.push({ offset, line: line + 1, token, why });
    };
    for (const { kind, start, end } of spans(src, known)) {
        const text = src.slice(start, end);
        let step = null;
        let hasFace = false;
        for (const t of tokens(text)) {
            const utility = baseUtility(t[0]);
            const why = classify(utility);
            if (why) flag(start + t.index, t[0], why);
            if (LG_CLASS.test(utility)) flag(start + t.index, t[0], "44px step on a button");
            if (!step && (STEP.test(utility) || known.get(utility)?.step)) step = { at: start + t.index, token: t[0] };
            if (utility === "ctl-button" || known.get(utility)?.face) hasFace = true;
        }
        for (const m of text.matchAll(LG_SIZE_PROP)) flag(start + m.index, m[0].replace(/\s+/g, ""), "44px step on a button");
        if (kind === "raw" && step && !hasFace) flag(step.at, step.token, "step without .ctl-button");
    }
    return out.sort((a, b) => a.offset - b.offset).map(({ line, token, why }) => ({ line, token, why }));
}

module.exports = { findControlTypeOverrides, collectClassConstants, baseUtility, classify };
