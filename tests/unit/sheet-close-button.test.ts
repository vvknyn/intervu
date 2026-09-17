import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHEET = join(__dirname, "..", "..", "src", "components", "ui", "sheet.tsx");

/**
 * True when a `<SheetPrimitive.Close ... className="...">` in `src` carries
 * a RESTING (non-`hover:`/`data-[state=...]:`/`focus:`-prefixed) `bg-*`
 * fill utility — the filled-grey-square defect: every other icon-only
 * control in the system (ghost buttons, DialogClose) has zero background
 * until interacted with. Shape-based (looks at the utility's prefix, not a
 * hardcoded token name) so `bg-muted`, `bg-card`, `bg-brand`, etc. are all
 * caught the same way.
 */
function closeButtonHasRestingFill(src: string): boolean {
    const m = src.match(/<SheetPrimitive\.Close\s+className="([^"]*)"/);
    if (!m) throw new Error("no <SheetPrimitive.Close className=\"...\"> found");
    const classes = m[1].split(/\s+/);
    return classes.some((c) => /^bg-/.test(c));
}

describe("Sheet close button", () => {
    it("sheet.tsx's SheetContent close control carries no resting background fill (only hover:bg-*)", () => {
        const src = readFileSync(SHEET, "utf8");
        assert.equal(closeButtonHasRestingFill(src), false);
        const m = src.match(/<SheetPrimitive\.Close\s+className="([^"]*)"/);
        assert.ok(m, "SheetPrimitive.Close must exist with a className");
        assert.match(m![1], /hover:bg-muted/, "hover state must still fill, matching the sitewide ghost-button idiom");
    });

    it("classifier: catches a reintroduced filled square, passes an icon-only hover-only control (other than bg-muted)", () => {
        const reintroduced = '<SheetPrimitive.Close className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center bg-card opacity-80 hover:bg-muted">';
        assert.equal(closeButtonHasRestingFill(reintroduced), true);

        const fixed = '<SheetPrimitive.Close className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center opacity-80 hover:bg-muted focus:ring-2 disabled:pointer-events-none">';
        assert.equal(closeButtonHasRestingFill(fixed), false);
    });
});
