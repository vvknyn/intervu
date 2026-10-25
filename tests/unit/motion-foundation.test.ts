import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOTION_CSS_VAR,
  MOTION_DURATION_MS,
  MOTION_EASE,
  MOTION_SCALE,
  MOTION_STAGGER_MS,
} from "../../src/lib/motion/interaction-contract";

const ROOT = join(__dirname, "..", "..");
const GLOBALS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const BUTTON = readFileSync(join(ROOT, "src/components/ui/button.tsx"), "utf8");
const CARD = readFileSync(join(ROOT, "src/components/ui/card.tsx"), "utf8");
const TOAST = readFileSync(join(ROOT, "src/lib/toast.tsx"), "utf8");
const SEARCH = readFileSync(join(ROOT, "src/components/search/SearchAutocomplete.tsx"), "utf8");
const LAYOUT = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
const NOT_FOUND = readFileSync(join(ROOT, "src/app/not-found.tsx"), "utf8");
const FOOTER = readFileSync(join(ROOT, "src/components/layout/Footer.tsx"), "utf8");
const THEME = readFileSync(join(ROOT, "src/components/providers/ThemeProvider.tsx"), "utf8");
const TABBAR = readFileSync(join(ROOT, "src/components/layout/MobileTabBar.tsx"), "utf8");
const APPLY_RETURN = readFileSync(join(ROOT, "src/components/jobs/ApplyReturnPrompt.tsx"), "utf8");
const UTILS = readFileSync(join(ROOT, "src/lib/utils.ts"), "utf8");

function cssToken(name: string): string | undefined {
  const m = GLOBALS.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`));
  return m?.[1]?.trim();
}

describe("motion token contract in globals.css", () => {
  it("declares named durations and easing", () => {
    assert.equal(cssToken("--ease-standard"), MOTION_EASE.standard);
    assert.equal(cssToken("--transition-instant"), "0ms");
    assert.equal(cssToken("--transition-press"), `${MOTION_DURATION_MS.press}ms`);
    assert.equal(cssToken("--transition-base"), `${MOTION_DURATION_MS.base}ms`);
    assert.equal(cssToken("--transition-enter"), `${MOTION_DURATION_MS.enter}ms`);
    assert.equal(cssToken("--transition-deck"), `${MOTION_DURATION_MS.deck}ms`);
    assert.equal(cssToken("--transition-page"), `${MOTION_DURATION_MS.page}ms`);
    assert.equal(cssToken("--transition-stack"), `${MOTION_DURATION_MS.stack}ms`);
    assert.equal(cssToken("--ease-stack"), MOTION_EASE.stack);
    assert.equal(cssToken("--ease-enter"), MOTION_EASE.enter);
    assert.equal(cssToken("--motion-stagger"), `${MOTION_STAGGER_MS}ms`);
    assert.equal(cssToken("--motion-press-scale"), String(MOTION_SCALE.press));
  });

  it("ships designed interaction utilities", () => {
    assert.match(GLOBALS, /\.designed-press/);
    assert.match(GLOBALS, /\.interactive-lift/);
    assert.match(GLOBALS, /\.enter-reveal/);
    assert.match(GLOBALS, /\.designed-focus:focus-visible/);
    assert.match(GLOBALS, /\.designed-focus-ring:focus-visible/);
  });

  it("collapses press/lift transforms under prefers-reduced-motion", () => {
    const block = GLOBALS.slice(GLOBALS.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(block, /\.designed-press:active/);
    assert.match(block, /\.interactive-lift:hover/);
    assert.match(block, /transform:\s*none !important/);
    for (const key of Object.values(MOTION_CSS_VAR)) {
      if (key.startsWith("--transition")) {
        assert.match(block, new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*0ms`));
      }
    }
  });
});

describe("motion foundation wiring", () => {
  it("Button uses designed-press without arbitrary scale literals", () => {
    assert.match(BUTTON, /designed-press/);
    assert.doesNotMatch(BUTTON, /active:scale-/);
  });

  it("Card applies lift/press only when interactive opt-in is set", () => {
    assert.match(CARD, /interactive\?: boolean/);
    assert.match(CARD, /interactive &&/);
    assert.match(CARD, /interactive-lift/);
    assert.match(CARD, /designed-press/);
    assert.match(CARD, /cursor-pointer/);
    assert.doesNotMatch(CARD, /shadow-\[/);
  });

  it("toast roles and mobile safe-area stack", () => {
    assert.match(TOAST, /role=\{isError \? "alert" : "status"\}/);
    assert.match(TOAST, /aria-live=\{isError \? "assertive" : "polite"\}/);
    assert.match(TOAST, /mobile-tabbar-h/);
    assert.match(TOAST, /safe-area-inset-bottom/);
  });

  it("SearchAutocomplete exposes combobox wiring and stable option ids", () => {
    assert.match(SEARCH, /role="combobox"/);
    assert.match(SEARCH, /aria-haspopup="listbox"/);
    assert.match(SEARCH, /aria-expanded=\{dropdownOpen\}/);
    assert.match(SEARCH, /aria-controls=\{dropdownOpen \? listboxId : undefined\}/);
    assert.match(SEARCH, /aria-activedescendant=/);
    assert.match(SEARCH, /id=\{listboxId\}/);
    assert.match(SEARCH, /id=\{optionId\(index\)\}/);
    assert.match(SEARCH, /CONTROL_FOCUS_VISIBLE/);
  });

  it("house focus export is shared by tab bar and controls", () => {
    assert.match(UTILS, /CHROME_FOCUS_VISIBLE/);
    assert.match(TABBAR, /CHROME_FOCUS_VISIBLE/);
  });

  it("ApplyReturnPrompt keeps aria-live polite only (no timing/storage changes)", () => {
    assert.match(APPLY_RETURN, /aria-live="polite"/);
    assert.doesNotMatch(APPLY_RETURN, /APPLY_RETURN_THRESHOLD/);
    assert.doesNotMatch(APPLY_RETURN, /captureEvent/);
  });
});

describe("status route motion", () => {
  it("404 panel uses enter-reveal token, not ad-hoc duration utilities", () => {
    assert.match(NOT_FOUND, /enter-reveal/);
    assert.doesNotMatch(NOT_FOUND, /duration-300/);
  });
});

describe("dark-only chrome", () => {
  it("forces dark from first paint in layout", () => {
    assert.match(LAYOUT, /className=\{`dark /);
    assert.match(LAYOUT, /classList\.add\("dark"\)/);
    assert.doesNotMatch(LAYOUT, /getItem\("intervu-mode"\)==="dark"/);
  });

  it("ThemeProvider applies dark document class without a theme toggle API", () => {
    assert.match(THEME, /applyDarkDocumentClass/);
    assert.match(THEME, /classList\.add\("dark"\)/);
    assert.doesNotMatch(THEME, /useTheme/);
    assert.doesNotMatch(THEME, /toggleMode/);
  });

  it("footer has no guest theme toggle", () => {
    assert.doesNotMatch(FOOTER, /toggleMode/);
    assert.doesNotMatch(FOOTER, /Dark mode/);
    assert.doesNotMatch(FOOTER, /Switch to light theme/);
  });
});
