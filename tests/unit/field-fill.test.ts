/**
 * One field look (docs/design-language.md §5): an input, textarea or select is `bg-card` with the hairline border,
 * and the primitive (src/components/ui/input.tsx, textarea.tsx, select.tsx) owns that fill. A call site that paints
 * its own fill makes the same kind of control look different from page to page.
 *
 * Measured 2026-11-08 on main b2176a6: text fields came in 4 fills: `bg-card` (the primitive), `bg-surface-2` (the
 * sign-in, reset and forgot-password forms and the tracker's date field, 7 fields), `bg-muted` (the story editor and
 * the context dialog, 6) and `bg-background` (the saved-search name, one field in two sizes). 14 call sites; 0 after, apart from
 * `src/components/mock/`, whose boards show other skins on purpose.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { blankComments, tagEnd } = require("../../scripts/design/control-scale.cjs") as {
    blankComments: (src: string) => string;
    tagEnd: (src: string, from: number) => number;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walkTsxFiles } = require("../../scripts/design/banned-classes.cjs") as { walkTsxFiles: (dir: string) => string[] };

const ROOT = join(__dirname, "..", "..");
const FIELD = /<(Input|Textarea|SelectTrigger|input|textarea|select)\b/g;
const NOT_A_TEXT_FIELD = /\btype=["'](?:checkbox|radio|hidden|file|range|color)["']/;
// A fill (any state: `focus:bg-…` too) other than the field's own `bg-card`, or a shadow.
const FILL = /(?<![\w-])((?:[\w-]+:)*)(bg-(?!clip-|none\b)[\w/.[\]()-]+|shadow-[\w/.[\]()-]+)/g;
const ALLOWED = /^bg-(?:card|transparent)$/;
const NOT_THE_FIELD = /^(?:selection|file|placeholder|before|after|\[&[^\]]*\]|\*):/;

/** Every field in `source` whose own className paints a fill, as "line: <Tag> tokens". */
export function fieldFills(source: string): string[] {
    const src = blankComments(source);
    const out: string[] = [];
    for (const m of src.matchAll(FIELD)) {
        const tag = src.slice(m.index, tagEnd(src, m.index ?? 0));
        if (NOT_A_TEXT_FIELD.test(tag)) continue;
        const bad = [...tag.matchAll(FILL)]
            .filter((t) => !NOT_THE_FIELD.test(t[1]) && !ALLOWED.test(t[2]) && t[2] !== "shadow-none")
            .map((t) => t[0]);
        if (bad.length) out.push(`${src.slice(0, m.index).split("\n").length}: <${m[1]}> ${bad.join(" ")}`);
    }
    return out;
}

describe("a text field has one fill, and the primitive owns it", () => {
    it("no field in src paints its own fill", () => {
        const offenders: string[] = [];
        for (const file of walkTsxFiles(join(ROOT, "src"))) {
            const rel = relative(ROOT, file);
            if (!rel.endsWith(".tsx") || rel.startsWith("src/components/ui/") || rel.startsWith("src/components/mock/")) continue;
            for (const hit of fieldFills(readFileSync(file, "utf8"))) offenders.push(`${rel}:${hit}`);
        }
        assert.deepEqual(offenders, [], "drop the fill: Input, Textarea and SelectTrigger are bg-card already");
    });

    it("classifier: catches a call-site fill in any state, passes the field's own fill and non-text inputs", () => {
        assert.deepEqual(fieldFills('<Input className="bg-surface-2 shadow-[var(--shadow-bevel-inset)]" />'), [
            "1: <Input> bg-surface-2 shadow-[var(--shadow-bevel-inset)]",
        ]);
        assert.equal(fieldFills('<Textarea\n  value={v}\n  className="h-28 focus:bg-background"\n/>').length, 1);
        assert.equal(fieldFills('<input className={cn(compact ? "bg-background" : "bg-card")} />').length, 1);
        assert.deepEqual(fieldFills('<select className="rounded-ctl border border-border bg-card px-3">'), []);
        assert.deepEqual(fieldFills('<Input className="pl-9 selection:bg-brand" />'), []);
        assert.deepEqual(fieldFills('<input type="checkbox" className="bg-muted" />'), []);
        assert.deepEqual(fieldFills('<div className="bg-muted"><Input className="pr-14" /></div>'), []);
    });
});
