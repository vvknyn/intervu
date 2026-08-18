"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

const MODE_STORAGE_KEY = "intervu-mode";

type Mode = "light" | "dark";

/**
 * Light/dark surface mode — and nothing else.
 *
 * This provider used to carry a second, parallel concern: an eight-entry accent
 * preset table (`src/lib/themes.ts`) whose `applyThemeToRoot` wrote `--brand`,
 * `--brand-foreground` and `--brand-muted` as INLINE STYLES on
 * documentElement. An inline style on :root outranks every stylesheet rule, so
 * globals.css never actually owned the brand colour at runtime — and with
 * DEFAULT_THEME = "green" and no UI anywhere calling setTheme, every visitor
 * was silently pinned to the retired emerald `16 149 106`.
 *
 * The visible consequence was two accents on screen at once: anything reading
 * --brand rendered emerald, while --live / --verdict-* (which the preset table
 * did not override) rendered the International Klein Blue that globals.css
 * declares. PR #217 moved --brand to Klein blue and no one saw it, because this
 * ran afterwards and put the old value back on every page load.
 *
 * DESIGN-LANGUAGE.md is unambiguous on both counts — "globals.css — the only
 * place values live" and "Scoped remaps of core token names are forbidden" — so
 * the preset half is gone rather than repointed at a ninth "klein" entry. The
 * mode half below is the only part anything ever consumed (TopBar reads
 * `mode`/`toggleMode`/`mounted`); `intervu-theme` in a returning visitor's
 * localStorage is simply never read again.
 */
interface ThemeContextValue {
  /** `mounted` lets a consumer (e.g. TopBar's toggle icon) defer rendering
   *  anything mode-dependent until after hydration, since the server always
   *  renders "light" but a returning visitor's real mode lives in
   *  localStorage and isn't known until the client mounts. */
  mode: Mode;
  toggleMode: () => void;
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  toggleMode: () => {},
  mounted: false,
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Demo-safe default: "light" when unset, deliberately NOT following the
    // OS/browser color-scheme preference — a first-time visitor always sees
    // the paper-light surface regardless of their system setting. The FOUC
    // guard script in layout.tsx's <head> already stamped `.dark` on <html>
    // before this ran if a prior visit stored "dark"; this just syncs React
    // state to match what's already painted.
    const storedMode = localStorage.getItem(MODE_STORAGE_KEY);
    setModeState(storedMode === "dark" ? "dark" : "light");
    setMounted(true);
  }, []);

  // Flips the `dark` class + persists it. The MutationObserver that used to
  // watch this attribute went with the preset table — the `.dark` block in
  // globals.css already re-resolves every token when the class changes, which
  // is what a stylesheet is for.
  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next: Mode = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem(MODE_STORAGE_KEY, next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, toggleMode, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}
