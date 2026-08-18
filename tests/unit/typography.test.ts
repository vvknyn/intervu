import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const GLOBALS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const LAYOUT = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");

function tsxFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) tsxFiles(full, acc);
        else if (entry.endsWith(".tsx")) acc.push(full);
    }
    return acc;
}

test("monospace is reserved for <code>, never a utility on prose", () => {
    // The rule, and why it is a rule (2026-08-17): the site read as
    // built-for-engineers to people outside tech. 295 `font-mono` call sites
    // existed; 110 dressed an uppercase LABEL and only 17 a number. Mono had
    // become the voice of the product rather than its code face — and the
    // corpus is genuinely multi-vertical, so that voice was turning away
    // nurses and teachers who have as many live postings as engineers do.
    //
    // Every genuinely monospaced surface was ALREADY marked up as <code>, so
    // globals.css binds the face to the element. That needs no allowlist of
    // blessed files, which is the point: an allowlist would have to be
    // extended by hand for each new file and would rot the first time nobody
    // did. If a thing is code, mark it up as code. If it cannot be <code>,
    // it is not code.
    // `\b` is the wrong boundary here and quietly matches INSIDE a
    // hyphen-joined name: `--font-mono-face`, the CSS variable that loads the
    // face, contains `font-mono` between two word boundaries. A sweep built on
    // \b mangled that declaration to `---face` — caught by the wiring test
    // below, which is the argument for asserting integrations and not just
    // shapes. A class token is delimited by whitespace or the quote, never by
    // a hyphen, so exclude hyphen neighbours explicitly.
    const UTILITY = /(?<![-\w])font-mono(?![-\w])/;
    const offenders: string[] = [];
    for (const file of tsxFiles(path.join(ROOT, "src"))) {
        const src = readFileSync(file, "utf8");
        // Only class strings count; prose in a comment explaining the rule
        // (like this one) is not a violation.
        for (const literal of src.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) || []) {
            if (UTILITY.test(literal)) {
                offenders.push(`${path.relative(ROOT, file)}: ${literal.slice(0, 80)}`);
            }
        }
    }
    assert.deepEqual(offenders, [], `use <code> instead of a font-mono utility:\n${offenders.join("\n")}`);
});

test("every font role consumed by CSS is actually loaded by next/font", () => {
    // The silent-failure guard. `--font-sans-face` and friends are supplied by
    // next/font in layout.tsx and consumed in globals.css. Rename one side
    // only — exactly what a future typeface swap invites — and nothing throws,
    // nothing fails to build, and no test goes red: the var just resolves to
    // nothing and the whole site quietly falls back to the system font stack.
    // A stale reference still RENDERS, which is why this has to be asserted
    // rather than noticed.
    const consumed = new Set(
        [...GLOBALS.matchAll(/var\((--font-[a-z0-9-]*-face)\)/g)].map((m) => m[1]),
    );
    const declared = new Set(
        [...LAYOUT.matchAll(/variable:\s*"(--font-[a-z0-9-]*-face)"/g)].map((m) => m[1]),
    );

    assert.ok(consumed.size > 0, "globals.css consumes no font faces — the token wiring moved");
    const missing = [...consumed].filter((v) => !declared.has(v));
    assert.deepEqual(missing, [], `consumed in CSS but never loaded in layout.tsx: ${missing.join(", ")}`);
});

test("font variables are named for their role, not their vendor", () => {
    // The naming was `--font-inter` / `--font-jetbrains-mono`, which meant a
    // typeface swap required renaming a variable in every consumer. That cost
    // is why the faces never changed even after the feedback arrived. Role
    // names keep the swap to one line in layout.tsx.
    const vendorNamed = [...LAYOUT.matchAll(/variable:\s*"(--font-[a-z0-9-]+)"/g)]
        .map((m) => m[1])
        .filter((v) => !v.endsWith("-face"));
    assert.deepEqual(vendorNamed, [], `name these for their role: ${vendorNamed.join(", ")}`);
});

test("data alignment comes from tabular figures, not from a monospace face", () => {
    // `.mono-data` is the one utility carrying the "numbers line up" pairing.
    // It used to reach for var(--font-mono) to get that, which conscripted an
    // IDE typeface for a job that tabular figures do — and dragged the
    // terminal register onto every count in the product as a side effect.
    const rule = /\.mono-data\s*\{([^}]*)\}/.exec(GLOBALS);
    assert.ok(rule, ".mono-data is gone — this guard needs re-pointing");
    assert.ok(
        /tabular-nums/.test(rule[1]),
        ".mono-data must set tabular figures; that is the whole point of it",
    );
    assert.ok(
        !/var\(--font-mono\)/.test(rule[1]),
        ".mono-data must not use the monospace face — tabular figures already align numbers",
    );
});
