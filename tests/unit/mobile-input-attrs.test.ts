import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phone text-entry contract. iOS zooms on focus under 16px, shows number
 * spinners on type=number, and labels the keyboard's return key from
 * `enterKeyHint`. The 16px floor and the keyboard-vs-fixed-bar rules live in
 * globals.css (asserted below); the per-input attributes are gated here.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walkTsxFiles } = require("../../scripts/design/banned-classes.cjs") as {
    walkTsxFiles: (dir: string) => string[];
};

const ROOT = path.resolve(__dirname, "../..");
// The /jobs hero combobox is being rebuilt by PR #1071; it adds its own enterKeyHint there.
const OWNED_BY_OTHER_PR = ["src/components/search/SearchAutocomplete.tsx"];

/** Every `<input …/>` / `<Input …/>` opening tag (JSX; `=>` never ends one, `/>` does). */
export function inputTags(src: string): Array<{ line: number; tag: string }> {
    const out: Array<{ line: number; tag: string }> = [];
    const re = /<(?:input|Input)\b[\s\S]*?\/>/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
        out.push({ line: src.slice(0, m.index).split("\n").length, tag: m[0] });
    }
    return out;
}
/** type="search", or a placeholder / aria-label that names a search field ("Search tracker…", "Role search") — not "Saved search name". */
export const isSearchInput = (tag: string) =>
    /type=["']search["']/.test(tag) ||
    [...tag.matchAll(/(?:placeholder|aria-label)=["']([^"']*)["']/g)].some(([, label]) => /^search\b|\bsearch[\s….]*$/i.test(label));
const hasHint = (tag: string, hint?: string) => (hint ? tag.includes(`enterKeyHint="${hint}"`) : /enterKeyHint=/.test(tag));

const files = walkTsxFiles(path.join(ROOT, "src")).map((f) => ({ rel: path.relative(ROOT, f), src: readFileSync(f, "utf8") }));

test("every search-type input carries enterKeyHint=search", () => {
    const offenders: string[] = [];
    for (const { rel, src } of files) {
        if (OWNED_BY_OTHER_PR.includes(rel)) continue;
        for (const { line, tag } of inputTags(src)) if (isSearchInput(tag) && !hasHint(tag, "search")) offenders.push(`${rel}:${line}`);
    }
    assert.deepEqual(offenders, []);
});

test("sign-in fields (email, password, one-time code) carry an enterKeyHint", () => {
    const offenders: string[] = [];
    for (const { rel, src } of files.filter((f) => f.rel.startsWith("src/components/auth/"))) {
        for (const { line, tag } of inputTags(src)) {
            if (/type=["']email["']|type=\{?[^}]*password|autoComplete=["']one-time-code["']/.test(tag) && !hasHint(tag)) offenders.push(`${rel}:${line}`);
        }
    }
    assert.deepEqual(offenders, []);
});

test("no type=number inputs: money and years are inputMode=numeric text (no spinners)", () => {
    const offenders: string[] = [];
    for (const { rel, src } of files) for (const { line, tag } of inputTags(src)) if (/type=["']number["']/.test(tag)) offenders.push(`${rel}:${line}`);
    assert.deepEqual(offenders, []);
});

test("detector: flags a search input without a hint, on shapes beyond the audited one", () => {
    const bad = (s: string) => inputTags(s).filter((t) => isSearchInput(t.tag) && !hasHint(t.tag, "search")).length;
    assert.equal(bad(`<Input type="search" onChange={(e) => go(e)} />`), 1);
    assert.equal(bad(`<input placeholder="Search tracker…" />`), 1);
    assert.equal(bad(`<Input aria-label="Role search" enterKeyHint="search" />`), 0);
    assert.equal(bad(`<Input type="email" />`), 0);
});

test("globals.css: 16px form-control floor, tab bar yields to focus, scroll padding", () => {
    const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    assert.match(css, /font-size:\s*max\(16px,\s*1em\)/);
    assert.match(css, /\):focus\)\s*\[data-mobile-tabbar\]\s*\{\s*display:\s*none/);
    assert.match(css, /scroll-padding-top:\s*calc\(var\(--jobs-sticky-offset\)/);
    assert.match(css, /scroll-padding-bottom:\s*calc\(var\(--mobile-tabbar-h\)/);
});
