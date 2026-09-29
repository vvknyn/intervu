import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const DIALOG_PATH = join(ROOT, "src", "components", "ui", "dialog.tsx");
const SHEET_PATH = join(ROOT, "src", "components", "ui", "sheet.tsx");
const TOAST_PATH = join(ROOT, "src", "lib", "toast.tsx");
const AUTH_POPOVER_PATH = join(ROOT, "src", "components", "auth", "auth-popover.tsx");
const LOGIN_FORM_PATH = join(ROOT, "src", "components", "auth", "login-form.tsx");
const JOBS_PAGE_PATH = join(ROOT, "src", "app", "jobs", "page.tsx");
const GLOBALS_CSS_PATH = join(ROOT, "src", "app", "globals.css");

test("DialogOverlay and DialogContent use modal z-index tier (z-[200], z-[210])", () => {
    const src = readFileSync(DIALOG_PATH, "utf8");
    assert.match(src, /data-slot="dialog-overlay"[\s\S]*?z-\[200\]/);
    assert.match(src, /data-slot="dialog-content"[\s\S]*?z-\[210\]/);
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

test("SheetOverlay and SheetContent use z-[150] tier (below Dialog, above page chrome)", () => {
    const src = readFileSync(SHEET_PATH, "utf8");
    assert.match(src, /SheetPrimitive\.Overlay[\s\S]*?z-\[150\]/);
    assert.match(src, /sheetVariants[\s\S]*?z-\[150\]/);
});

test("Toaster uses z-[300] to float above dialogs and sheets", () => {
    const src = readFileSync(TOAST_PATH, "utf8");
    assert.match(src, /z-\[300\]/);
});

test("mobile-search-cta uses z-40 and is suppressed when authOpen or importOpen", () => {
    const src = readFileSync(JOBS_PAGE_PATH, "utf8");
    assert.match(src, /data-testid="mobile-search-cta"[\s\S]*?z-40/);
    assert.match(src, /const showMobileSearchCta =[\s\S]*?!authOpen/);
    assert.match(src, /const showMobileSearchCta =[\s\S]*?!importOpen/);
});

test("globals.css hides floating CTAs when body is scroll-locked by an open modal", () => {
    const src = readFileSync(GLOBALS_CSS_PATH, "utf8");
    assert.match(src, /body\[data-scroll-locked\] \[data-testid="mobile-search-cta"\]/);
    assert.match(src, /body\[data-scroll-locked\] \[data-testid="apply-return-prompt"\]/);
});

test("LoginForm submit button has explicit type submit and auth-submit-button testid", () => {
    const src = readFileSync(LOGIN_FORM_PATH, "utf8");
    assert.match(src, /type="submit"/);
    assert.match(src, /data-testid="auth-submit-button"/);
});
