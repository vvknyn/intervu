import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * ONE control-height scale (globals.css `--control-h-sm|md|lg` → `.ctl-*`).
 * Every button / input / select / tab / chip takes a step from it, so controls
 * that share a row share a height, and the 44px touch target is a coarse-pointer
 * hit area, never a taller visual. The detector lives in
 * scripts/design/control-scale.cjs; exemptions are an on-line
 * `control-scale-allow: <reason>` marker, never a file list.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findHandRolledControlHeights } = require("../../scripts/design/control-scale.cjs") as {
    findHandRolledControlHeights: (src: string) => Array<{ line: number; token: string }>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walkTsxFiles } = require("../../scripts/design/banned-classes.cjs") as {
    walkTsxFiles: (dir: string) => string[];
};

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

test("no control in src hand-rolls its height (h-* / min-h-* / py-*) outside the scale", () => {
    const offenders: string[] = [];
    for (const file of walkTsxFiles(path.join(ROOT, "src"))) {
        for (const hit of findHandRolledControlHeights(readFileSync(file, "utf8"))) {
            offenders.push(`${path.relative(ROOT, file)}:${hit.line} ${hit.token}`);
        }
    }
    assert.deepEqual(offenders, [], "use a size variant or .ctl-sm|md|lg (or mark the line `control-scale-allow: <reason>`)");
});

test("detector: flags a hand-rolled height on every control shape", () => {
    const tokens = (src: string) => findHandRolledControlHeights(src).map((h) => h.token);
    // The header Sign in that surfaced this: a Button made 44px by its call site.
    assert.deepEqual(tokens(`<Button className={cn("min-h-11 rounded-ctl", RING)}>Sign in</Button>`), ["min-h-11"]);
    // Other shapes of the same class.
    assert.deepEqual(tokens(`<input\n  type="text"\n  className="py-2 text-sm"\n/>`), ["py-2"]);
    assert.deepEqual(tokens(`<button className="flex sm:h-[52px] px-3">x</button>`), ["sm:h-[52px]"]);
    assert.deepEqual(tokens(`<Link className={cn(buttonVariants({ size: "sm" }), "h-10")}>Go</Link>`), ["h-10"]);
    assert.deepEqual(tokens(`<SelectTrigger className="h-9" />`), ["h-9"]);
    assert.deepEqual(tokens(`<TabItem current className="h-12">A</TabItem>`), ["h-12"]);
    assert.deepEqual(tokens(`<TabsTrigger value="a" className="lg:py-1.5">A</TabsTrigger>`), ["lg:py-1.5"]);
    assert.deepEqual(findHandRolledControlHeights(`<div>\n<Chip className="h-6">a</Chip>`).map((h) => h.line), [2]);
});

test("detector: leaves scale steps, glyph inputs, non-controls, comments and marked lines alone", () => {
    const none = (src: string) => assert.deepEqual(findHandRolledControlHeights(src), [], src);
    none(`<Button size="lg" className="ctl-md ctl-square px-3">x</Button>`);
    none(`<input type="checkbox" className="h-4 w-4" />`);
    none(`<div className="h-11 py-4"><button className="ctl-md">x</button></div>`);
    none(`<a href="https://example.com/a//b" className="underline">x</a>\n<button className="ctl-sm">y</button>`);
    none(`// <Button className="h-11">\n<Button>ok</Button>`);
    none(`<button\n  // control-scale-allow: full-width list row, padding is layout\n  className="py-3"\n>`);
    none(`<input type="file" className="ctl-lg file:h-7" />`);
});

test("the scale is three steps, and the touch floor is a hit area on every step", () => {
    const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const steps = [...css.matchAll(/--control-h-([a-z]+)\s*:/g)].map((m) => m[1]);
    assert.deepEqual(steps, ["sm", "md", "lg"]);
    for (const s of steps) assert.match(css, new RegExp(`@utility ctl-${s}\\s*\\{[^}]*var\\(--control-h-${s}\\)`));
    const coarse = /@media \(pointer: coarse\)\s*\{([\s\S]*?)\n  \}/.exec(css)?.[1] ?? "";
    for (const s of steps) assert.match(coarse, new RegExp(`\\.ctl-${s}[^{]*\\)::before`), `.ctl-${s} gets the ::before hit area`);
    assert.match(coarse, /\bbutton\b[^{]*\)::before/, "every <button> gets the hit area, sized or not");
    assert.match(coarse, /height:\s*max\(100%,\s*var\(--hit-min\)\)/);
});

test("every size variant of every ui primitive takes a scale step (or carries the on-line marker)", () => {
    const dir = path.join(ROOT, "src/components/ui");
    let checked = 0;
    for (const file of walkTsxFiles(dir)) {
        for (const block of readFileSync(file, "utf8").matchAll(/\bsize:\s*\{([\s\S]*?)\n\s*\},/g)) {
            for (const [line, name, classes] of block[1].matchAll(/^\s*"?([\w-]+)"?:\s*"([^"]*)".*$/gm)) {
                checked++;
                if (/control-scale-allow:/.test(line)) continue;
                assert.match(classes, /\bctl-(sm|md|lg)\b/, `${path.relative(ROOT, file)} size "${name}" must pick a control-scale step`);
            }
        }
    }
    // Button (7 boxed sizes) and TabItem (inline) at minimum — a regex that stops matching must not pass vacuously.
    assert.ok(checked >= 8, `only ${checked} size variants found`);
});
