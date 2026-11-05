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

// HIG Sheets: a sheet has a grabber and swipes down to dismiss; iOS 26 floats a partial sheet inset from
// the screen's sides and bottom with every corner rounded. A Dialog is drawn as that sheet on a phone, so it
// carries all of it, from the same pieces the Sheet primitive uses (journey J-HIG-03 drags one closed).
test("Dialog at compact width is the floating bottom sheet: inset, rounded, grabber, swipe to dismiss, safe-area inset", () => {
    const src = read("src", "components", "ui", "dialog.tsx");
    for (const cls of ["max-sm:bottom-[var(--sheet-inset)]", "max-sm:inset-x-[var(--sheet-inset)]", "max-sm:max-w-none", "max-sm:rounded-[var(--radius-sheet)]", "env(safe-area-inset-bottom)"]) {
        assert.ok(src.includes(cls), `dialog.tsx lacks ${cls}`);
    }
    assert.match(src, /<SheetHandle\b[^>]*sm:hidden/, "the grabber shows at compact width only");
    assert.match(src, /useBottomSheetSwipeDismiss\(compact,/, "the Sheet's own swipe-to-dismiss, on at compact width");
    const sheet = read("src", "components", "ui", "sheet.tsx");
    for (const cls of ["max-sm:bottom-[var(--sheet-inset)]", "max-sm:rounded-[var(--radius-sheet)]"]) {
        assert.ok(sheet.includes(cls), `sheet.tsx bottom variant lacks ${cls}`);
    }
});

// Every bottom sheet shows a grabber (HIG Sheets: "Include a grabber in a resizable sheet"): either the shared
// SheetBar header or a SheetHandle of its own. Two sheets had neither (the company page's job sheet header was
// hand-drawn with one; the tracker's posting sheet had none, 2026-11-02 audit).
test("every bottom SheetContent call site shows a grabber", () => {
    const offenders: string[] = [];
    for (const file of callSites().filter((f) => !f.includes(join("components", "mock")) && !f.includes(join("app", "mock")))) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/<SheetContent\b[^>]*side="bottom"[\s\S]*?<\/SheetContent>/g)) {
            // The header may live in a body component in the same file (the pursuit sheet's SheetBar does).
            if (!/<(SheetBar|SheetHandle)\b/.test(m[0]) && !/<(SheetBar|SheetHandle)\b/.test(src)) offenders.push(`${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length}`);
        }
    }
    assert.deepEqual(offenders, []);
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

// Liquid Glass (HIG Materials): the overlay layer is one material, painted by the primitives in components/ui
// (`material-glass`). A call site that paints its own fill or shadow turns its sheet, dialog or menu back into
// an opaque slab: the sign-in dialog, the account menu and two modals did (2026-11-02). A media player is
// content and may keep its frame with a `glass-exempt:` comment on the line above.
test("no overlay call site paints its own fill or overlay shadow over the glass", () => {
    const offenders: string[] = [];
    for (const file of callSites().filter((f) => !f.includes(join("components", "mock")) && !f.includes(join("app", "mock")))) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/<(DialogContent|SheetContent|PopoverContent|DropdownMenuContent|DropdownMenuSubContent|SelectContent|AlertDialogContent)\b[^<]*/g)) {
            const before = src.slice(0, m.index).split("\n").slice(-2).join("\n");
            if (/glass-exempt:/.test(before)) continue;
            if (/(^|[\s"'`])(bg-|shadow-\[var\(--shadow-overlay\)\])/.test(m[0])) {
                offenders.push(`${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length} <${m[1]}>`);
            }
        }
    }
    assert.deepEqual(offenders, []);
});
