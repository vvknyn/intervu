#!/usr/bin/env node
// Idempotent mechanical sweep for the shared rule table in banned-classes.cjs
// (Group A part 2 — the five class families the Part-1 sweep/gate missed).
// Operates ONLY inside extracted string-literal / template-literal-chunk
// regions (never bare code or bare JSX text), same safety invariant as the
// Part-1 sweep this one succeeds — a region containing a literal `;` is
// skipped whole (a CSS-in-JS declaration block, never a Tailwind class list).
//
// Usage: node scripts/design/sweep-banned-classes.cjs [--dry]
"use strict";
const fs = require("fs");
const path = require("path");
const { ROOT, rules, walkTsxFiles, isFileAllowed } = require("./banned-classes.cjs");

const SRC = path.join(ROOT, "src");
const DRY = process.argv.includes("--dry");

// ---------------------------------------------------------------------------
// String / template-literal region extractor (ported unchanged from the
// Part-1 sweep — same safety contract, so it isn't re-derived here).
// ---------------------------------------------------------------------------
function extractStringRegions(src) {
    const regions = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
        const c = src[i];
        if (c === "/" && src[i + 1] === "/") {
            const nl = src.indexOf("\n", i);
            i = nl === -1 ? n : nl + 1;
            continue;
        }
        if (c === "/" && src[i + 1] === "*") {
            const close = src.indexOf("*/", i + 2);
            i = close === -1 ? n : close + 2;
            continue;
        }
        if (c === "'" && i > 0 && /[A-Za-z0-9_$]/.test(src[i - 1])) {
            i++;
            continue;
        }
        if (c === '"' || c === "'") {
            const quote = c;
            let j = i + 1;
            while (j < n && src[j] !== quote) {
                if (src[j] === "\\") j++;
                j++;
            }
            regions.push({ start: i + 1, end: j, quoted: true });
            i = j + 1;
            continue;
        }
        if (c === "`") {
            let j = i + 1;
            let segStart = j;
            while (j < n) {
                if (src[j] === "\\") {
                    j += 2;
                    continue;
                }
                if (src[j] === "`") {
                    regions.push({ start: segStart, end: j });
                    j++;
                    break;
                }
                if (src[j] === "$" && src[j + 1] === "{") {
                    regions.push({ start: segStart, end: j });
                    let depth = 1;
                    const exprStart = j + 2;
                    j += 2;
                    while (j < n && depth > 0) {
                        if (src[j] === "{") depth++;
                        else if (src[j] === "}") depth--;
                        j++;
                    }
                    const exprEnd = j - 1;
                    const nested = extractStringRegions(src.slice(exprStart, exprEnd));
                    for (const r of nested) {
                        regions.push({ start: r.start + exprStart, end: r.end + exprStart, quoted: r.quoted });
                    }
                    segStart = j;
                    continue;
                }
                j++;
            }
            i = j;
            continue;
        }
        i++;
    }
    return regions;
}

function linesBefore(src, offset, n) {
    let end = src.indexOf("\n", offset);
    if (end === -1) end = src.length;
    let start = end;
    for (let k = 0; k < n; k++) {
        const prev = src.lastIndexOf("\n", start - 1);
        if (prev === -1) {
            start = 0;
            break;
        }
        start = prev;
    }
    return src.slice(start, end);
}

/** Collapse consecutive duplicate whitespace-separated class tokens produced
 *  when two rules independently rewrite two different source classes to the
 *  same output (e.g. glass-panel and glass-panel-raised both -> the same
 *  bg-card/border pair on one className). Only applied to a region a rule
 *  actually touched, and only to a fully-quoted string (never a template
 *  chunk, where edge whitespace can matter for concatenation). */
function dedupeTokens(text) {
    const seen = new Set();
    return text
        .split(/(\s+)/)
        .filter((tok) => {
            if (!tok.trim()) return true;
            if (seen.has(tok)) return false;
            seen.add(tok);
            return true;
        })
        .join("")
        .replace(/[ \t]{2,}/g, " ");
}

function applyRules(text) {
    let out = text;
    let changed = false;
    for (const rule of rules) {
        const before = out;
        out = out.replace(rule.pattern, rule.replace);
        if (out !== before) changed = true;
    }
    return { out, changed };
}

function processFile(file, totals) {
    const original = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    const regions = extractStringRegions(original);

    let out = "";
    let prevEnd = 0;
    let fileChanged = false;
    for (const region of regions) {
        const raw = original.slice(region.start, region.end);
        out += original.slice(prevEnd, region.start);
        if (raw.includes(";") || /design-lint-allow/.test(linesBefore(original, region.start, 6))) {
            out += raw;
            prevEnd = region.end;
            continue;
        }
        const { out: rewritten, changed } = applyRules(raw);
        let text = rewritten;
        if (changed) {
            fileChanged = true;
            totals.occurrences++;
            if (region.quoted) text = dedupeTokens(text).trim();
        }
        out += text;
        prevEnd = region.end;
    }
    out += original.slice(prevEnd);

    if (out !== original && !DRY) fs.writeFileSync(file, out, "utf8");
    if (out !== original) totals.filesChanged.add(rel);
    return out !== original;
}

function main() {
    const totals = { occurrences: 0, filesChanged: new Set() };
    const files = walkTsxFiles(SRC).filter((f) => !isFileAllowed(fs.readFileSync(f, "utf8")));
    let changedFiles = 0;
    for (const file of files) {
        if (processFile(file, totals)) changedFiles++;
    }
    console.log(`Scanned ${files.length} files, ${changedFiles} changed (dry=${DRY})`);
    console.log(`${totals.occurrences} region(s) touched across ${totals.filesChanged.size} file(s)`);
}

main();
