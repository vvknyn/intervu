#!/usr/bin/env node
// Single source of truth for the Group-A-part-2 banned-class families
// (docs/design/DESIGN-LANGUAGE.md) — consumed by BOTH:
//   - tests/unit/design-language.test.ts (detection only, via `rules` + `isScrimLine`)
//   - scripts/design/sweep-banned-classes.cjs (detection AND rewrite, via `rules`)
// Adding a family means adding one entry here; neither consumer enumerates
// class names of its own.
"use strict";
const path = require("path");
const { readdirSync, statSync } = require("fs");

const ROOT = path.resolve(__dirname, "../..");

// Transactional emails are raw HTML strings styled with literal inline CSS,
// not Tailwind utility classes — mirrors the exclusion design-language.test.ts
// already applied before this table existed (see its walkTsxFiles history).
const EXCLUDED_DIRS = new Set([path.join(ROOT, "src/lib/email")]);

const ALLOW_WINDOW_LINES = 6;

// The one deliberate enumerated-name exception in this file (per the coding
// rules' "never gate by enumerating names except the one deliberate
// FILE_EXEMPTIONS ratchet"): the whole-file `design-lint-allow-file` marker
// is itself an escape hatch from the class-shape rules below, so THIS list
// is what keeps that escape hatch from growing silently — a test
// (design-language.test.ts) asserts it stays equal to the actual set of
// files carrying the marker, so an unreviewed new whole-file exemption fails
// the gate instead of slipping in unnoticed.
const FILE_EXEMPTIONS = [
    { file: "src/components/marketing/WhatsAppThreadHero.tsx", why: "Decorative marketing mock of a WhatsApp thread — raw pixel values recreate a third-party chat UI, not this app's own surfaces." },
    { file: "src/components/mock/AuthGateMock.tsx", why: "Decorative onboarding mockup — intentional raw values too dense/scattered for a per-line marker." },
    { file: "src/components/mock/CompletenessMock.tsx", why: "Decorative onboarding mockup — same as AuthGateMock.tsx." },
];

function walkTsxFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (EXCLUDED_DIRS.has(full)) continue;
        if (statSync(full).isDirectory()) {
            walkTsxFiles(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

/** Blank `//` and `/* *\/` comment CONTENT (keep line breaks/length) so prose
 *  naming a banned class ("used to be bg-blue-100") can't trip a match. */
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

function isFileAllowed(raw) {
    return /design-lint-allow-file/.test(raw);
}

/** True when a `design-lint-allow` comment sits within the window of RAW
 *  lines ending at (and including) `lineIdx` (0-based). */
function isLineAllowed(rawLines, lineIdx) {
    const start = Math.max(0, lineIdx - ALLOW_WINDOW_LINES + 1);
    for (let i = start; i <= lineIdx; i++) {
        if (/design-lint-allow(?!-file)/.test(rawLines[i])) return true;
    }
    return false;
}

/** True for the one sanctioned translucent surface (modal/sheet scrim): a
 *  bg-black|white/NN opacity class co-occurring with `fixed` + an `inset-*`
 *  class in the SAME string/line — a structural test, not a filename list. */
function isScrimLine(line) {
    return /\bbg-(?:black|white)\/[0-9]{1,3}\b/.test(line) && /\bfixed\b/.test(line) && /\binset-(?:0|x-0|y-0)\b/.test(line);
}

/**
 * Scans every .tsx?/.ts? file under `dir` for `pattern`, honouring both
 * exemption markers plus an optional per-rule structural skip, and returns
 * `path:line: match` strings.
 */
function findOffenders(dir, pattern, opts = {}) {
    const { readFileSync } = require("fs");
    const offenders = [];
    for (const file of walkTsxFiles(dir)) {
        const raw = readFileSync(file, "utf8");
        if (isFileAllowed(raw)) continue;
        const rawLines = raw.split("\n");
        const strippedLines = stripComments(raw).split("\n");
        for (let i = 0; i < strippedLines.length; i++) {
            const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
            const m = strippedLines[i].match(re);
            if (!m) continue;
            if (isLineAllowed(rawLines, i)) continue;
            if (opts.skip?.(strippedLines[i], rawLines[i])) continue;
            offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${m[0]}`);
        }
    }
    return offenders;
}

// ---------------------------------------------------------------------------
// Rule table
//
// Every `pattern` carries a `(?![a-zA-Z0-9-])` (or equivalent) terminator
// instead of a trailing `\b` — `\b` fires on a hyphen, so it would let a
// truncated match (`rounded` out of `rounded-bl-none`, `glass-panel` out of
// `glass-panel-raised`) through. The terminator forces the regex to consume
// the FULL token or fail, so a compliant longer sibling is never touched
// without an explicit exclusion list.
//
// A leading `(?:[\w-]+:)*` on deletion rules also eats any Tailwind variant
// prefix (hover:, dark:, xl:, ...) attached to a deleted utility, mirroring
// the existing RE_BLUR_SHADOW idiom from the Part-1 sweep — otherwise a
// dangling `hover:` survives with nothing after it.
// ---------------------------------------------------------------------------

const SIDE = "(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|ee|es)";
const SIZE = "(?:xs|sm|md|lg|xl|2xl|3xl|full)";

/** Opacity-suffix prefixes — the same 15-role vocabulary the pre-existing
 *  "no raw Tailwind palette class survives" test already established;
 *  reused here rather than re-declared so the two colour rules can't drift. */
const OPACITY_PREFIXES = ["bg", "text", "border", "ring", "divide", "outline", "decoration", "fill", "stroke", "accent", "caret", "from", "via", "to", "placeholder"];

const rules = [
    {
        name: "rounded-{side}-{size} (named sizes are a code-hygiene lie; rounded-full is a real visual bug)",
        // No bare, unsuffixed "rounded" alternative: globals.css sets
        // --radius: 0px same as every --radius-{size} key, so bare `rounded`
        // is ALREADY visually 0 — and scanning arbitrary source text (not
        // just class strings) for the bare word collides with plain English/
        // JS identifiers (`const rounded = Math.round(...)` in
        // src/lib/jobs/presentation.ts really exists and would false-positive
        // here). The dashed forms below can't collide with prose/identifiers
        // and cover every real violation confirmed in the repo.
        pattern: new RegExp(`(?:[\\w-]+:)*\\brounded(?:-${SIDE})?-${SIZE}(?![a-zA-Z0-9-])`, "g"),
        // rounded-none (explicit) rather than deleting the class outright: a
        // <button>/<input>/<select> can carry a UA-stylesheet default corner
        // radius even with no rounded-* class at all, so only an explicit
        // zero is guaranteed square on every element, not just a <div>.
        replace: () => "rounded-none",
        why: "Every --radius-* key is already 0 (DESIGN-LANGUAGE.md) EXCEPT rounded-full, which Tailwind computes as calc(infinity*1px) independent of any --radius-* token — the one named size that is a real, visible circle/pill on screen, not just a misleading name. The rest (rounded-lg, rounded-md, ...) already render at 0 already; removing them is the same code-hygiene fix the pre-existing /co-scoped rounded-2xl/rounded-3xl test applies ('a component naming a size that does nothing reads as a lie').",
    },
    {
        name: "named shadow-* preset (bare, no brackets)",
        pattern: /(?:[\w-]+:)*\bshadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner)(?![a-zA-Z0-9-])/g,
        replace: "",
        why: "Elevation is none outside the one sanctioned overlay token (shadow-[var(--shadow-overlay)], untouched — no brackets in this alternation). shadow-none is also untouched (not in the alternation).",
    },
    {
        name: "glass-panel-accent-top",
        pattern: /(?:[\w-]+:)*\bglass-panel-accent-top(?![a-zA-Z0-9-])/g,
        replace: "border-t-2 border-t-brand",
        why: "Was a dedicated CSS class only because .glass-panel-raised's `border` shorthand beat a border-t-* utility in the cascade; once both sides are plain utilities in the same layer that conflict is gone.",
    },
    {
        name: "glass-panel / glass-card / glass-panel-raised",
        pattern: /(?:[\w-]+:)*\b(?:glass-panel-raised|glass-card|glass-panel)(?![a-zA-Z0-9-])/g,
        // bg-card, not bg-background: globals.css's own .glass-panel/.glass-card
        // rule reads `background: rgb(var(--card))`, and --card !== --background
        // (verified: light 255/255/255 vs 246/248/252, dark 18/18/18 vs 10/10/10)
        // — bg-background would be a visible fill-colour regression.
        replace: "bg-card border border-border",
        why: "Flat surface system: background + 1px border, no blur/shadow/translucency, same computed colours the CSS class produced.",
    },
    {
        name: "glass-tint-blue",
        pattern: /(?:[\w-]+:)*\bglass-tint-blue(?![a-zA-Z0-9-])/g,
        replace: "bg-muted text-brand",
        why: "globals.css's .glass-tint-blue sets both background AND `color: rgb(var(--brand))` — bg-muted alone would silently drop the chip's text colour.",
    },
    {
        name: "glass-tint-emerald",
        pattern: /(?:[\w-]+:)*\bglass-tint-emerald(?![a-zA-Z0-9-])/g,
        replace: "bg-muted text-live",
        why: "globals.css's .glass-tint-emerald sets color: rgb(var(--live)); preserved as text-live.",
    },
    {
        name: "glass-tint-amber",
        pattern: /(?:[\w-]+:)*\bglass-tint-amber(?![a-zA-Z0-9-])/g,
        replace: "bg-muted text-warn",
        why: "globals.css's .glass-tint-amber sets color: rgb(var(--warn)); preserved as text-warn (zero live call sites today, kept for parity with the CSS rule being deleted).",
    },
    {
        name: "glass-tint-purple",
        pattern: /(?:[\w-]+:)*\bglass-tint-purple(?![a-zA-Z0-9-])/g,
        replace: "bg-muted text-foreground",
        why: "globals.css's .glass-tint-purple has no rulebook role and reads color: rgb(var(--foreground)) (zero live call sites today, kept for parity with the CSS rule being deleted).",
    },
    {
        name: "glass-tint-muted",
        pattern: /(?:[\w-]+:)*\bglass-tint-muted(?![a-zA-Z0-9-])/g,
        replace: "bg-muted",
        why: "globals.css's .glass-tint-muted sets no `color` override, so bg-muted alone is a faithful mapping.",
    },
    {
        name: "backdrop-* filter utility",
        pattern: /(?:[\w-]+:)*\bbackdrop-[a-z][a-zA-Z0-9-]*(?![a-zA-Z0-9-])/g,
        replace: "",
        why: "No blur/saturate/brightness/etc. backdrop filter survives outside the sanctioned overlay scrim, which uses a plain bg-black/50 (no backdrop-* utility at all) — see the scrim classifier above.",
    },
    {
        name: "shadow-none (inert, leaves a transparent shadow stack)",
        pattern: /(?:[\w-]+:)*\bshadow-none\b/g,
        replace: "",
        why: "Every shadow token resolves to none at the theme, so shadow-none overrides nothing; it only sets the --tw-shadow stack, which the computed-style probe then reads as a box-shadow.",
    },
    {
        name: "colour/NN opacity suffix",
        pattern: new RegExp(`\\b((?:${OPACITY_PREFIXES.join("|")})-[a-zA-Z][a-zA-Z-]*)\\/[0-9]{1,3}\\b`, "g"),
        replace: (match, base, ...rest) => {
            // String.replace passes (match, p1, ..., offset, fullString);
            // fullString is always the last argument regardless of capture count.
            const full = rest[rest.length - 1];
            if (/^bg-(?:black|white)$/.test(base) && isScrimLine(String(full))) {
                return `${base}/50`;
            }
            return base;
        },
        skip: (line) => isScrimLine(line),
        why: "No opacity-modified colour survives except the sanctioned modal/sheet scrim (bg-black|white/NN co-occurring with fixed + inset-0/x-0/y-0 on the same line), normalised to /50.",
    },
];

module.exports = {
    ROOT,
    EXCLUDED_DIRS,
    ALLOW_WINDOW_LINES,
    FILE_EXEMPTIONS,
    rules,
    walkTsxFiles,
    stripComments,
    isFileAllowed,
    isLineAllowed,
    isScrimLine,
    findOffenders,
};
