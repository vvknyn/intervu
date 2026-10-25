import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * ONE page scale (docs/design-language.md §3, §6): every page sits in
 * <PageContainer> / `.shell-row` (the TopBar's width + gutter, so a page's left
 * edge is the logo's), every <h1> is a <PageTitle>, h2–h6 take a heading-scale
 * step, and long-form copy is <Prose>. The detector lives in
 * scripts/design/page-scale.cjs; exemptions are an on-line
 * `page-scale-allow: <reason>` marker, never a file list.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findHandRolledPageStyles } = require("../../scripts/design/page-scale.cjs") as {
    findHandRolledPageStyles: (src: string) => Array<{ line: number; rule: string; token: string }>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walkTsxFiles } = require("../../scripts/design/banned-classes.cjs") as {
    walkTsxFiles: (dir: string) => string[];
};

const ROOT = path.resolve(__dirname, "../..");
const hits = (src: string) => findHandRolledPageStyles(src).map((h) => `${h.rule} ${h.token}`);

test("no page in src hand-rolls its container, heading size or prose", () => {
    const offenders: string[] = [];
    for (const file of walkTsxFiles(path.join(ROOT, "src"))) {
        for (const hit of findHandRolledPageStyles(readFileSync(file, "utf8"))) {
            offenders.push(`${path.relative(ROOT, file)}:${hit.line} ${hit.rule} ${hit.token}`);
        }
    }
    assert.deepEqual(offenders, [], "use PageContainer / PageTitle / SectionTitle / Prose (or mark the line `page-scale-allow: <reason>`)");
});

test("detector: container — a centred column with its own gutter or the shell's width", () => {
    // /about, which surfaced this: a centred 3xl column put the h1 at x=360 under a logo at x=120.
    assert.deepEqual(hits(`<div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">`), ["container max-w-3xl"]);
    // Other shapes: arbitrary width, `p-*` gutter, one container split across cn() args.
    assert.deepEqual(hits(`<main className="mx-auto w-full max-w-[1120px] p-4">`), ["container max-w-[1120px]"]);
    assert.deepEqual(hits(`<div className={cn("mx-auto max-w-6xl", wide && "lg:px-8")}>`), ["container max-w-6xl"]);
    // The shell's own width centred without a gutter is still the shell row hand-rolled.
    assert.deepEqual(hits(`<div className="mx-auto max-w-7xl py-8">`), ["container max-w-7xl"]);
    // A class constant outside JSX.
    assert.deepEqual(findHandRolledPageStyles(`const X = 1;\nconst WRAP = "mx-auto max-w-4xl px-6";`).map((h) => h.line), [2]);
});

test("detector: heading — PageTitle owns the h1 size; h2–h6 stay on the scale", () => {
    assert.deepEqual(hits(`<h1 className="text-4xl font-semibold">About</h1>`), ["heading <h1> text-4xl"]);
    assert.deepEqual(hits(`<PageTitle className="sm:text-3xl">x</PageTitle>`), ["heading <PageTitle> sm:text-3xl"]);
    assert.deepEqual(hits(`<h2\n  className="text-lg font-semibold"\n>`), ["heading <h2> text-lg"]);
    // Size names come from globals.css, so a theme alias is caught by construction.
    assert.deepEqual(hits(`<h3 className="text-title-sm">x</h3>`), ["heading <h3> text-title-sm"]);
    assert.deepEqual(hits(`<h2 className="text-[18px]">x</h2>`), ["heading <h2> text-[18px]"]);
});

test("detector: prose — a bare `prose` class outside <Prose>", () => {
    assert.deepEqual(hits(`<article className="prose prose-sm dark:prose-invert">`), ["prose prose"]);
    assert.deepEqual(hits(`<div className="lg:prose">`), ["prose lg:prose"]);
});

test("detector: leaves primitives, look-alike tokens, comments and marked lines alone", () => {
    const none = (src: string) => assert.deepEqual(findHandRolledPageStyles(src), [], src);
    none(`<PageContainer measure="reading" className="py-10"><PageTitle>About</PageTitle></PageContainer>`);
    none(`<div className="shell-row py-8"><SectionTitle className="mb-3">A</SectionTitle></div>`);
    none(`<div className="mx-auto max-w-md p-0">x</div>`);
    none(`<form className="mx-auto max-w-sm space-y-4">x</form>`);
    none(`<h2 className="text-xl text-2 font-semibold">x</h2>\n<h3 className="text-sm text-muted-foreground">y</h3>`);
    none(`import { Prose } from "@/components/ui/prose";\n<p className="not-prose prose-sm:mt-2">x</p>`);
    none(`// <h1 className="text-4xl">old</h1>\n<PageTitle>new</PageTitle>`);
    none(`{/* page-scale-allow: a fixed toast, not a page column */}\n<div className="mx-auto max-w-sm px-4">`);
});
