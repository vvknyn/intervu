import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A button's type comes from its control step, never from its call site
 * (Vivek, 2026-09-29: buttons read as "fat pills with mismatched fonts" —
 * call sites were setting their own size, weight and corner on top of the
 * primitive). globals.css holds the one step→type map beside the height scale:
 * 24px → 12px, 32px → 14px, 44px → 16px, all at weight 500, painted by
 * `.ctl-button` on the control corner. The Button primitive carries it; a raw
 * <button> on a step adds it. The 44px step is for fields and the /jobs Search
 * submit, and phone action buttons via `size="touch"` (32px on desktop, 44px
 * below lg). The detector lives in scripts/design/control-type.cjs; exemptions
 * are an on-line `control-type-allow: <reason>` marker, never a file list.
 */

type Hit = { line: number; token: string; why: string };
type Constants = Map<string, { step: boolean; face: boolean }>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findControlTypeOverrides, collectClassConstants } = require("../../scripts/design/control-type.cjs") as {
    findControlTypeOverrides: (src: string, constants?: Constants) => Hit[];
    collectClassConstants: (sources: string[], exportedOnly?: boolean) => Constants;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walkTsxFiles } = require("../../scripts/design/banned-classes.cjs") as {
    walkTsxFiles: (dir: string) => string[];
};

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const tokens = (src: string, constants?: Constants) => findControlTypeOverrides(src, constants).map((h) => h.token);
const whys = (src: string) => findControlTypeOverrides(src).map((h) => h.why);

test("no button in src sets its own text size, weight or corner, or sits on the 44px step without a reason", () => {
    const files = walkTsxFiles(path.join(ROOT, "src"));
    const constants = collectClassConstants(files.map((f) => readFileSync(f, "utf8")));
    const offenders: string[] = [];
    for (const file of files) {
        for (const hit of findControlTypeOverrides(readFileSync(file, "utf8"), constants)) {
            offenders.push(`${path.relative(ROOT, file)}:${hit.line} ${hit.token} (${hit.why})`);
        }
    }
    assert.deepEqual(
        offenders,
        [],
        "take the type from the step (Button size, or `.ctl-sm|md|lg` + `.ctl-button` on a raw <button>), " +
            "or mark the line `control-type-allow: <reason>` when the element is not a button face",
    );
});

test("detector: flags a call-site text size, weight or corner on every button shape", () => {
    // The two that surfaced this: "Browse all matches" and the header Sign in.
    assert.deepEqual(
        tokens(`<Button type="button" size="lg" data-testid="hub-browse-all-matches" className="w-full text-xs font-semibold sm:w-auto">`),
        ["size=\"lg\"", "text-xs", "font-semibold"],
    );
    assert.deepEqual(tokens(`<Button variant="ghost" className={cn("font-normal text-muted-foreground", RING)}>Sign in</Button>`), ["font-normal"]);
    // buttonVariants(...) and the classes cn()'d after it.
    assert.deepEqual(tokens(`<Link className={cn(buttonVariants({ size: "sm" }), "rounded-pill text-base")}>Go</Link>`), ["rounded-pill", "text-base"]);
    // A raw <button> on a step, variant-prefixed and arbitrary forms included.
    assert.deepEqual(
        tokens(`<button className="ctl-md ctl-button sm:text-sm hover:font-bold [&_span]:text-[13px] rounded-t-none">x</button>`),
        ["sm:text-sm", "hover:font-bold", "[&_span]:text-[13px]", "rounded-t-none"],
    );
    assert.deepEqual(tokens(`<div role="button" className="ctl-sm ctl-button rounded">x</div>`), ["rounded"]);
    // Any element that paints the face is a button, whatever its tag.
    assert.deepEqual(tokens(`<PopoverTrigger className={cn(chipVariants(), "ctl-button text-xs")} />`), ["text-xs"]);
    // The theme's role sizes are sizes too.
    assert.deepEqual(tokens(`<Button className="text-meta">x</Button>`), ["text-meta"]);
    assert.deepEqual(findControlTypeOverrides(`<div>\n<Button\n  className="font-medium"\n>`).map((h) => h.line), [3]);
});

test("detector: the 44px step on a button needs a reason", () => {
    assert.deepEqual(tokens(`<Button size="lg">Apply</Button>`), ['size="lg"']);
    assert.deepEqual(tokens(`<Button size={"icon-lg"} aria-label="x" />`), ['size={"icon-lg"}']);
    assert.deepEqual(tokens(`<Link className={buttonVariants({ size: "lg" })}>Go</Link>`), ['size:"lg"']);
    assert.deepEqual(tokens(`<button className="ctl-lg ctl-button px-4">Upload</button>`), ["ctl-lg"]);
    assert.deepEqual(whys(`<button className="ctl-lg ctl-button px-4">Upload</button>`), ["44px step on a button"]);
});

test("detector: a raw <button> on a step must paint the face, even when the step comes from a shared constant", () => {
    assert.deepEqual(whys(`<button className="ctl-md px-3">Sort</button>`), ["step without .ctl-button"]);
    const constants = collectClassConstants([`export const toolbarControlHeight = "ctl-md";`]);
    assert.deepEqual(tokens(`<button className={cn(toolbarControlHeight, "px-2 text-xs")}>Clear</button>`, constants), ["toolbarControlHeight", "text-xs"]);
    assert.deepEqual(tokens(`<button className={cn(toolbarControlHeight, "ctl-button px-2")}>Clear</button>`, constants), []);
    // A face constant carries the face (and is itself checked); an interpolated step is inherited.
    const shared = collectClassConstants([
        `export const toolbarControlHeight = "ctl-md";\nexport const toolbarChipClass = \`ctl-button inline-flex \${toolbarControlHeight} px-3\`;`,
    ]);
    assert.deepEqual(shared.get("toolbarChipClass"), { step: true, face: true });
    assert.deepEqual(tokens(`<button className={cn(chipVariants(), toolbarChipClass)}>Remote</button>`, shared), []);
    assert.deepEqual(tokens(`export const toolbarChipClass = "ctl-button ctl-md px-3 text-xs";`), ["text-xs"]);
    // Only exported names travel between files, so two files' locals cannot collide.
    assert.equal(collectClassConstants([`const cls = "ctl-md";`]).has("cls"), false);
});

test("detector: leaves colours, stepless text buttons, other controls, comments and marked lines alone", () => {
    const none = (src: string) => assert.deepEqual(findControlTypeOverrides(src), [], src);
    none(`<Button variant="ghost" className="text-muted-foreground hover:text-foreground">x</Button>`);
    none(`<Button className="bg-[#ececec] text-[#12151a] text-[color:var(--x)]">x</Button>`);
    none(`<Button size="icon" className="w-full text-left text-brand">x</Button>`);
    // A text button that is not on a step (an inline link, a list row) is not a control face.
    none(`<button className="text-xs font-semibold text-brand hover:underline">Sign in</button>`);
    // Fields keep their own type; tabs, switches and select triggers keep their recipe.
    none(`<input className="ctl-lg rounded-ctl text-base" />`);
    none(`<Input className="ctl-lg rounded-ctl text-base" />`);
    none(`<button role="tab" className="ctl-md text-sm font-medium">A</button>`);
    none(`<button role="switch" className="ctl-sm rounded-pill">A</button>`);
    none(`<ButtonGroup className="rounded-ctl text-xs" />`);
    none(`// <Button className="text-xs">\n<Button>ok</Button>`);
    none(`<Button\n  // control-type-allow: an inline text link set with the 12px note above it\n  size="link"\n  className="text-xs"\n>`);
    none(`{/* control-type-allow: shares the row with the 44px email field */}\n<Button size="lg" type="submit">Join</Button>`);
    // The marker needs a reason.
    assert.deepEqual(tokens(`<Button className="text-xs"> {/* control-type-allow: */}`), ["text-xs"]);
});

test("the step→type map lives once, beside the height scale, and the face paints it at 500", () => {
    const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const size = (s: string) => new RegExp(`--control-text-${s}\\s*:\\s*([\\d.]+rem)`).exec(css)?.[1];
    assert.deepEqual(["sm", "md", "lg"].map(size), ["0.75rem", "0.875rem", "1rem"], "24→12, 32→14, 44→16px");
    for (const s of ["sm", "md", "lg"]) {
        assert.equal(css.match(new RegExp(`--control-text-${s}\\s*:`, "g"))?.length, 1, `--control-text-${s} is declared once`);
        const utility = new RegExp(`@utility ctl-${s}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
        assert.match(utility, new RegExp(`--ctl-text:\\s*var\\(--control-text-${s}\\)`), `.ctl-${s} carries its size`);
        assert.match(utility, /--ctl-weight:\s*var\(--control-weight\)/, `.ctl-${s} carries the control weight`);
    }
    assert.equal(css.match(/--control-weight\s*:/g)?.length, 1, "--control-weight is declared once");
    assert.match(css, /--control-weight:\s*500;/);
    // One face rule; a face with no step takes the nearest stepped ancestor's type (the vars inherit).
    const faces = [...css.matchAll(/\.ctl-button\b[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
    assert.equal(faces.length, 1, "one .ctl-button rule");
    assert.match(faces[0], /font-size:\s*var\(--ctl-text\)/);
    assert.match(faces[0], /line-height:\s*var\(--ctl-leading\)/);
    assert.match(faces[0], /font-weight:\s*var\(--ctl-weight\)/);
    assert.match(faces[0], /border-radius:\s*var\(--radius-ctl\)/);
    // Loaded as its own cut, or the 500 falls back to the 400 face and only the computed style says 500.
    assert.match(read("src/app/layout.tsx"), /Source_Sans_3\(\{[\s\S]*?weight:\s*\[[^\]]*"500"[^\]]*\]/);
});

test("the Button primitive paints the face and names no type or corner of its own", () => {
    const src = read("src/components/ui/button.tsx");
    const base = /cva\(\s*cn\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]+)"/.exec(src)?.[1] ?? "";
    assert.match(base, /\bctl-button\b/);
    const sizes = /\bsize:\s*\{([\s\S]*?)\n\s*\},/.exec(src)?.[1] ?? "";
    assert.ok(sizes.length > 0, "size variants not found");
    for (const classes of [base, ...[...sizes.matchAll(/:\s*"([^"]*)"/g)].map((m) => m[1])]) {
        assert.doesNotMatch(classes, /(?<![\w-])(?:text-(?:xs|sm|base|lg|xl)|font-(?:normal|medium|semibold|bold)|rounded(?:-[\w-]+)?)(?![\w-])/, classes);
    }
});
