/**
 * Site-wide dark/light toggle — the single mechanism behind every "moon/sun"
 * button in the app. Extracted from `TopBar.tsx` (2026-08-03 landing-hero
 * rebuild) so the new hero nav's own theme toggle reuses the exact same
 * class-on-`<html>` flip + `"intervu-dark"` persistence key instead of a
 * second hand-rolled copy that could drift from this one (e.g. a different
 * storage key, or forgetting to notify listeners). `layout.tsx`'s no-flash
 * inline script reads `"intervu-dark"` before paint — that key is the one
 * piece of this module that must never change without updating that script.
 *
 * `useSyncExternalStore`-shaped (subscribe/snapshot/serverSnapshot) rather
 * than a mount-effect + state, because reading the DOM class into React
 * state inside an effect is what the react-hooks lint now flags as
 * set-state-in-effect; this is the hydration-safe equivalent (server
 * snapshot `false` = what SSR renders, the client snapshot reads the real
 * class).
 */
const darkListeners = new Set<() => void>();

export function subscribeDark(onChange: () => void) {
    darkListeners.add(onChange);
    return () => darkListeners.delete(onChange);
}

export function getDarkSnapshot(): boolean {
    return document.documentElement.classList.contains("dark");
}

export function getDarkServerSnapshot(): boolean {
    // Instrument product is dark-void only — SSR and client agree.
    return true;
}

/** Kept for call sites; always stays on dark (landing / jobs one visual world). */
export function toggleDark() {
    const root = document.documentElement;
    root.classList.add("dark");
    try {
        localStorage.setItem("intervu-dark", "1");
    } catch {
        /* ignore */
    }
    darkListeners.forEach((cb) => cb());
}
