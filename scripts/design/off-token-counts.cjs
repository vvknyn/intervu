#!/usr/bin/env node
// Per-surface off-token ratchet — docs/design-language.md §8.
//
// Unlike scripts/design/banned-classes.cjs (a hard zero-tolerance gate with
// per-line/per-file allow markers), this is a COUNTING ratchet: each surface
// gets a baseline count per off-token pattern, and a count may only go down.
// It exists because the design-language migration is landing surface by
// surface across parallel PRs — a hard ban would block every surface that
// hasn't been converted yet, while a per-surface ratchet lets each surface's
// debt shrink independently and fails only a REGRESSION (a count going up),
// never the pre-existing baseline itself.
//
// Consumed by tests/unit/design-token-ratchet.test.ts (detection, via
// `scanOffTokenCounts` + `diffOffTokenCounts` against the committed
// tests/unit/design-token-baseline.json) and runnable directly:
//   node scripts/design/off-token-counts.cjs          # report vs baseline
//   node scripts/design/off-token-counts.cjs --write  # regenerate baseline
"use strict";
const path = require("path");
const { readFileSync, writeFileSync, existsSync } = require("fs");
const { ROOT, walkTsxFiles, stripComments, isFileAllowed } = require("./banned-classes.cjs");

// Surface -> directory roots (relative to ROOT). Resolution is longest-
// matching-root-wins (see buildRootIndex/surfaceForFile below), so a surface
// nested inside another (for-you lives under src/components/jobs and
// src/lib/jobs) is carved out cleanly just by listing its own, more specific
// root — no separate exclusion list to keep in sync.
const SURFACE_ROOTS = {
    "for-you": ["src/components/jobs/for-you", "src/lib/jobs/for-you"],
    jobs: ["src/app/jobs", "src/components/jobs", "src/lib/jobs"],
    yours: ["src/app/yours", "src/components/applications"],
    resume: ["src/app/resume", "src/components/resume-builder"],
    tracker: ["src/components/tracker"],
    settings: ["src/app/settings", "src/components/settings"],
    company: ["src/app/co", "src/app/companies", "src/components/company"],
    auth: [
        "src/app/auth",
        "src/app/oauth",
        "src/app/login",
        "src/components/auth",
        "src/components/oauth",
        "src/lib/auth",
    ],
    layout: ["src/components/layout"],
    ui: ["src/components/ui"],
    trends: ["src/app/trends", "src/components/trends"],
    marketing: ["src/components/marketing"],
};

// The exact off-token families named in docs/design-language.md §8.
const PATTERNS = [
    { name: "rounded-none", re: /\brounded-none\b/g },
    { name: "rounded-size", re: /\brounded-(?:sm|md|lg|xl|2xl|3xl|full)\b/g },
    { name: "rounded-arbitrary", re: /rounded-\[/g },
    { name: "text-arbitrary", re: /\btext-\[/g },
    { name: "leading-arbitrary", re: /\bleading-\[/g },
    { name: "size-arbitrary", re: /\b[wh]-\[/g },
    { name: "padding-arbitrary", re: /\bp[xy]?-\[/g },
    { name: "hex-literal", re: /#[0-9a-fA-F]{3,8}\b/g },
    { name: "shadow-utility", re: /\bshadow-[a-z]/g },
    { name: "inline-style", re: /style=\{\{/g },
];

function countMatches(text, re) {
    const m = text.match(re);
    return m ? m.length : 0;
}

/** Every declared surface root, sorted longest-path-first so a nested
 *  surface's root is checked before its parent's. */
function buildRootIndex() {
    const index = [];
    for (const [surface, roots] of Object.entries(SURFACE_ROOTS)) {
        for (const rel of roots) index.push({ surface, abs: path.join(ROOT, rel) });
    }
    return index.sort((a, b) => b.abs.length - a.abs.length);
}

/** Longest-matching-root-wins surface resolution for one absolute file path. */
function surfaceForFile(fileAbs, rootIndex) {
    for (const { surface, abs } of rootIndex) {
        if (fileAbs === abs || fileAbs.startsWith(abs + path.sep)) return surface;
    }
    return null;
}

/**
 * Scans every declared surface directory and returns
 * { [surface]: { [patternName]: count } }, zero-filled for every declared
 * surface/pattern pair (even a surface with zero offenders) so a fresh
 * baseline write and a later diff always compare the same key set.
 * Honours the same whole-file `design-lint-allow-file` exemption as the
 * hard-ban gate (banned-classes.cjs) — a file exempted there is exempted
 * from this count too, since it's the same "not this app's own surface"
 * judgment either way.
 */
function scanOffTokenCounts() {
    const rootIndex = buildRootIndex();
    const files = new Set();
    for (const { abs } of rootIndex) {
        if (!existsSync(abs)) continue;
        for (const f of walkTsxFiles(abs)) files.add(f);
    }

    const counts = {};
    for (const surface of Object.keys(SURFACE_ROOTS)) {
        counts[surface] = {};
        for (const { name } of PATTERNS) counts[surface][name] = 0;
    }

    for (const file of files) {
        const surface = surfaceForFile(file, rootIndex);
        if (!surface) continue;
        const raw = readFileSync(file, "utf8");
        if (isFileAllowed(raw)) continue;
        const stripped = stripComments(raw);
        for (const { name, re } of PATTERNS) {
            counts[surface][name] += countMatches(stripped, re);
        }
    }
    return counts;
}

/**
 * Pure diff between a fresh scan and the committed baseline. No I/O — this
 * is what the unit tests exercise with synthetic fixtures.
 * `increased` entries fail the ratchet (a real regression); `decreased`
 * entries pass but should prompt tightening the baseline — a count going
 * DOWN never fails.
 */
function diffOffTokenCounts(current, baseline) {
    const increased = [];
    const decreased = [];
    const surfaces = new Set([...Object.keys(current), ...Object.keys(baseline)]);
    for (const surface of surfaces) {
        const currentPatterns = current[surface] ?? {};
        const baselinePatterns = baseline[surface] ?? {};
        const patterns = new Set([...Object.keys(currentPatterns), ...Object.keys(baselinePatterns)]);
        for (const pattern of patterns) {
            const cur = currentPatterns[pattern] ?? 0;
            const base = baselinePatterns[pattern] ?? 0;
            if (cur > base) increased.push({ surface, pattern, baseline: base, current: cur });
            else if (cur < base) decreased.push({ surface, pattern, baseline: base, current: cur });
        }
    }
    const bySurfacePattern = (a, b) => a.surface.localeCompare(b.surface) || a.pattern.localeCompare(b.pattern);
    increased.sort(bySurfacePattern);
    decreased.sort(bySurfacePattern);
    return { increased, decreased };
}

const BASELINE_PATH = path.join(ROOT, "tests/unit/design-token-baseline.json");

function readBaseline() {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function writeBaseline(counts) {
    writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + "\n");
}

if (require.main === module) {
    const counts = scanOffTokenCounts();
    if (process.argv.includes("--write")) {
        writeBaseline(counts);
        console.log(`design-token-baseline.json written: ${BASELINE_PATH}`);
    } else {
        const baseline = readBaseline();
        const { increased, decreased } = diffOffTokenCounts(counts, baseline);
        if (decreased.length) {
            console.log(
                `off-token-counts: ${decreased.length} surface/pattern count(s) went down — tighten the baseline: ` +
                    decreased.map((d) => `${d.surface}/${d.pattern} ${d.baseline}->${d.current}`).join(", "),
            );
        }
        if (increased.length) {
            console.error(
                `off-token-counts: ${increased.length} surface/pattern count(s) increased over baseline:\n` +
                    increased.map((d) => `  ${d.surface} ${d.pattern}: ${d.baseline} -> ${d.current}`).join("\n"),
            );
            process.exit(1);
        }
        console.log("off-token-counts: no surface/pattern exceeds its baseline.");
    }
}

module.exports = {
    SURFACE_ROOTS,
    PATTERNS,
    scanOffTokenCounts,
    diffOffTokenCounts,
    buildRootIndex,
    surfaceForFile,
    BASELINE_PATH,
    readBaseline,
    writeBaseline,
};
