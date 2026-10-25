import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const DIALOG_PATH = join(ROOT, "src", "components", "ui", "dialog.tsx");
const SHEET_PATH = join(ROOT, "src", "components", "ui", "sheet.tsx");
const TOAST_PATH = join(ROOT, "src", "lib", "toast.tsx");
const AUTH_POPOVER_PATH = join(ROOT, "src", "components", "auth", "auth-popover.tsx");
const LOGIN_FORM_PATH = join(ROOT, "src", "components", "auth", "login-form.tsx");
const GLOBALS_CSS_PATH = join(ROOT, "src", "app", "globals.css");

// 8b775697 moved the z-index tiers into globals.css tokens; the tier values
// are asserted on the tokens, the primitives on reading them (the class constants
// are shared with ui/alert-dialog.tsx).
test("DialogOverlay and DialogContent use modal z-index tier (200, 210)", () => {
    const src = readFileSync(DIALOG_PATH, "utf8");
    const css = readFileSync(GLOBALS_CSS_PATH, "utf8");
    assert.match(src, /dialogOverlayClass =[\s\S]*?z-\[var\(--z-dialog-scrim\)\]/);
    assert.match(src, /dialogContentClass =[\s\S]*?z-\[var\(--z-dialog\)\]/);
    assert.match(css, /--z-dialog-scrim:\s*200;/);
    assert.match(css, /--z-dialog:\s*210;/);
});

/** Every .tsx under src/, outside the ui primitives that own the tiers. */
function callSiteFiles(dir = join(ROOT, "src")): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return path.includes(join("src", "components", "ui")) ? [] : callSiteFiles(path);
        return entry.name.endsWith(".tsx") ? [path] : [];
    });
}

// A z-class on a call site beats the primitive's tier (cn/tailwind-merge keeps the last z-*), and
// the scrim keeps its own tier: a Customize dialog passed z-[70] sat under its z-200 scrim, dimmed
// and unclickable. The primitives own stacking; call sites pass none.
test("no call site overrides the z-index of an overlay or a floating menu", () => {
    const offenders: string[] = [];
    for (const file of callSiteFiles()) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/<(DialogContent|DialogOverlay|SheetContent|SheetOverlay|SelectContent|PopoverContent|DropdownMenuContent|DropdownMenuSubContent|TooltipContent)\b[^<]*/g)) {
            if (/(^|[\s"'`:])z-(\d|\[)/.test(m[0])) {
                offenders.push(`${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length} <${m[1]}>`);
            }
        }
    }
    assert.deepEqual(offenders, [], "remove the z-* class; the primitive's tier keeps it above what it opens from");
});

// Menus sit a layer above dialogs, so a menu that hosts its own dialog stays open on top of it
// (the account menu's Feedback item did). Open the dialog from state beside the menu instead.
test("no dropdown or popover content renders a dialog, sheet or modal inside it", () => {
    const offenders: string[] = [];
    for (const file of callSiteFiles()) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/<(DropdownMenuContent|PopoverContent)\b[\s\S]*?<\/\1>/g)) {
            if (/<(Dialog|Sheet|AlertDialog)\b|<\w+Modal\b/.test(m[0])) {
                offenders.push(`${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length} <${m[1]}>`);
            }
        }
    }
    assert.deepEqual(offenders, []);
});

test("DialogContent enforces max-height and internal scrolling on mobile", () => {
    const src = readFileSync(DIALOG_PATH, "utf8");
    assert.match(src, /max-h-\[var\(--overlay-max-h\)\]/);
    // the token is the single dvh definition (vh fallback, dvh where supported)
    const css = readFileSync(GLOBALS_CSS_PATH, "utf8");
    assert.match(css, /--overlay-max-h:\s*calc\(100vh - 2rem\)/);
    assert.match(css, /@supports \(height: 100dvh\)[\s\S]*?--overlay-max-h:\s*calc\(100dvh - 2rem\)/);
    assert.match(src, /overflow-y-auto/);
    assert.match(src, /overscroll-contain/);
});

test("AuthPopover DialogContent and PopoverContent have mobile max-height and scrolling", () => {
    const src = readFileSync(AUTH_POPOVER_PATH, "utf8");
    // Dialog: capped by the shared overlay token; scrolling comes from the DialogContent primitive.
    assert.match(src, /<DialogContent[\s\S]*?max-h-\[min\(640px,var\(--overlay-max-h\)\)\]/);
    assert.match(src, /<PopoverContent[^>]*max-h-\[min\(92dvh,640px\)\][^>]*overflow-y-auto/);
});

// Portaled to <body>: a menu opened from a sheet or dialog must clear it, or it opens behind (the
// Track role status picker and the Feedback type picker sat at 70 under a 150 sheet / 210 dialog).
test("Select, popover, dropdown and tooltip content use the 220 tier (above dialogs, below toasts)", () => {
    const css = readFileSync(GLOBALS_CSS_PATH, "utf8");
    assert.match(css, /--z-popover:\s*220;/);
    for (const name of ["select", "popover", "dropdown-menu", "tooltip"]) {
        const src = readFileSync(join(ROOT, "src", "components", "ui", `${name}.tsx`), "utf8");
        assert.match(src, /z-\[var\(--z-popover\)\]/, `${name}.tsx reads the popover tier`);
        assert.doesNotMatch(src, /\bz-(\d+|\[\d+\])[\s"]/, `${name}.tsx has no fixed z-index left`);
    }
});

test("SheetOverlay and SheetContent use z-[150] tier (below Dialog, above page chrome)", () => {
    const src = readFileSync(SHEET_PATH, "utf8");
    assert.match(src, /SheetPrimitive\.Overlay[\s\S]*?z-\[150\]/);
    assert.match(src, /sheetVariants[\s\S]*?z-\[150\]/);
});

test("Toaster uses the 300 tier to float above dialogs and sheets", () => {
    const src = readFileSync(TOAST_PATH, "utf8");
    assert.match(src, /z-\[var\(--z-toast\)\]/);
    assert.match(readFileSync(GLOBALS_CSS_PATH, "utf8"), /--z-toast:\s*300;/);
});

test("globals.css hides floating CTAs when body is scroll-locked by an open modal", () => {
    const src = readFileSync(GLOBALS_CSS_PATH, "utf8");
    assert.match(src, /body\[data-scroll-locked\] \[data-testid="apply-return-prompt"\]/);
});

test("LoginForm submit button has explicit type submit and auth-submit-button testid", () => {
    const src = readFileSync(LOGIN_FORM_PATH, "utf8");
    assert.match(src, /type="submit"/);
    assert.match(src, /data-testid="auth-submit-button"/);
});
