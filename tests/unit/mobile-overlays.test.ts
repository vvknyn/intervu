import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { compactTooltipSide } from "../../src/components/ui/tooltip";

const ROOT = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

test("a tooltip beside its trigger moves above it on a phone, whichever side it asked for", () => {
    assert.equal(compactTooltipSide("right", true), "top");
    assert.equal(compactTooltipSide("left", true), "top");
    assert.equal(compactTooltipSide("bottom", true), "bottom");
    assert.equal(compactTooltipSide(undefined, true), undefined);
    assert.equal(compactTooltipSide("right", false), "right");
});

test("the tooltip keeps 16px from the screen edge and never outgrows the room it has", () => {
    const src = read("src", "components", "ui", "tooltip.tsx");
    assert.match(src, /collisionPadding = 16/);
    assert.match(src, /--radix-tooltip-content-available-width/);
});

test("Dialog is a full-width bottom sheet with a safe-area inset at compact width", () => {
    const src = read("src", "components", "ui", "dialog.tsx");
    for (const cls of ["max-sm:bottom-0", "max-sm:inset-x-0", "max-sm:max-w-none", "max-sm:rounded-b-none", "env(safe-area-inset-bottom)"]) {
        assert.ok(src.includes(cls), `dialog.tsx lacks ${cls}`);
    }
});

/** Every .tsx under src/, outside the ui primitives. */
function callSites(dir = join(ROOT, "src")): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const path = join(dir, e.name);
        if (e.isDirectory()) return path.includes(join("src", "components", "ui")) ? [] : callSites(path);
        return e.name.endsWith(".tsx") ? [path] : [];
    });
}

// A popover that presents a choice list is a ChoicePopover (a bottom sheet with 44px rows on a phone).
// The choice rows are `Affordance`s (checkbox/radio labels), so a file that renders them inside a bare
// PopoverContent is a missed site.
test("no call site puts choice rows in a bare PopoverContent", () => {
    const offenders = callSites()
        .filter((f) => {
            const src = readFileSync(f, "utf8");
            return /<PopoverContent\b/.test(src) && /<Affordance\b/.test(src);
        })
        .map((f) => relative(ROOT, f));
    assert.deepEqual(offenders, []);
});
