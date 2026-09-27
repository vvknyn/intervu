"use client";

import { useEffect } from "react";

const MODE_STORAGE_KEY = "intervu-mode";

function applyDarkDocumentClass() {
  document.documentElement.classList.add("dark");
  try {
    localStorage.setItem(MODE_STORAGE_KEY, "dark");
  } catch {
    /* private mode */
  }
}

/** Ensures `.dark` on `<html>` after hydration (layout FOUC script runs first). */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyDarkDocumentClass();
  }, []);

  return children;
}
