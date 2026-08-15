"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { themes, getTheme, DEFAULT_THEME, type Theme } from "@/lib/themes";

const STORAGE_KEY = "intervu-theme";
const MODE_STORAGE_KEY = "intervu-mode";

type Mode = "light" | "dark";

interface ThemeContextValue {
  theme: string;
  setTheme: (name: string) => void;
  currentTheme: Theme;
  /** Light/dark surface concern — separate from the accent preset above.
   *  `mounted` lets a consumer (e.g. TopBar's toggle icon) defer rendering
   *  anything mode-dependent until after hydration, since the server always
   *  renders "light" but a returning visitor's real mode lives in
   *  localStorage and isn't known until the client mounts. */
  mode: Mode;
  toggleMode: () => void;
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  currentTheme: getTheme(DEFAULT_THEME),
  mode: "light",
  toggleMode: () => {},
  mounted: false,
});

export function useTheme() {
  return useContext(ThemeContext);
}

function applyThemeToRoot(themeName: string) {
  const theme = getTheme(themeName);
  const isDark = document.documentElement.classList.contains("dark");
  const colors = isDark ? theme.colors.dark : theme.colors.light;

  document.documentElement.style.setProperty("--brand", colors.brand);
  document.documentElement.style.setProperty("--brand-foreground", colors["brand-foreground"]);
  document.documentElement.style.setProperty("--brand-muted", colors["brand-muted"]);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState(DEFAULT_THEME);
  const [mode, setModeState] = useState<Mode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const initial = stored && themes[stored] ? stored : DEFAULT_THEME;
    setThemeState(initial);

    // Demo-safe default: "light" when unset, deliberately NOT following the
    // OS/browser color-scheme preference — a first-time visitor always sees
    // the paper-light surface regardless of their system setting. The FOUC
    // guard script in layout.tsx's <head> already stamped `.dark` on <html>
    // before this ran if a prior visit stored "dark"; this just syncs React
    // state to match what's already painted.
    const storedMode = localStorage.getItem(MODE_STORAGE_KEY);
    setModeState(storedMode === "dark" ? "dark" : "light");

    applyThemeToRoot(initial);
    setMounted(true);

    // Watch for dark mode changes to re-apply theme colors
    const observer = new MutationObserver(() => {
      const current = localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
      applyThemeToRoot(current);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  const setTheme = useCallback((name: string) => {
    if (!themes[name]) return;
    setThemeState(name);
    localStorage.setItem(STORAGE_KEY, name);
    applyThemeToRoot(name);
  }, []);

  // Just flips the `dark` class + persists it — does NOT re-apply accent
  // colors itself. The MutationObserver registered above already reacts to
  // any class-attribute change on <html> and re-applies the current theme's
  // colors for whichever mode is now active, so duplicating that call here
  // would just run it twice.
  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next: Mode = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem(MODE_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const currentTheme = getTheme(theme);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, currentTheme, mode, toggleMode, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}
