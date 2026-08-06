/**
 * Persistent override for the IP-based location default (lib/geo/ip-default.ts):
 * once a searcher dismisses the /jobs default-location chip, it stays gone —
 * across reloads, across tabs — until they explicitly clear it some other
 * way (no re-enable UI exists yet; this is a one-way "don't guess" per the
 * product's honesty rule that a silent geo-filter can never come back
 * uninvited).
 *
 * Same SSR-safe read/write/notify shape as recent-searches.ts and
 * follows/alert-cursor.ts: `hasLocalStorage` guards SSR/private-mode, every
 * localStorage touch is try/caught (a lost preference is not a functional
 * error), and the module-level cache + listener set make this
 * `useSyncExternalStore`-compatible so JobsPage doesn't need its own
 * mount-effect + state for something this file already owns.
 */
export const SUPPRESS_LOCATION_DEFAULT_KEY = "intervu.jobs.suppressLocationDefault";

function hasLocalStorage(): boolean {
    return typeof localStorage !== "undefined";
}

function readSuppressLocationDefault(): boolean {
    if (!hasLocalStorage()) return false;
    try {
        return localStorage.getItem(SUPPRESS_LOCATION_DEFAULT_KEY) === "1";
    } catch {
        return false;
    }
}

function writeSuppressLocationDefault(): void {
    if (!hasLocalStorage()) return;
    try {
        localStorage.setItem(SUPPRESS_LOCATION_DEFAULT_KEY, "1");
    } catch {
        /* ignore quota errors */
    }
}

let cache: boolean | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((cb) => cb());
}

export function subscribeSuppressLocationDefault(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
}

export function getSuppressLocationDefaultSnapshot(): boolean {
    if (cache == null) cache = readSuppressLocationDefault();
    return cache;
}

/** SSR snapshot — false matches what the server renders (no override known
 *  yet), so hydration can't mismatch. */
export function getSuppressLocationDefaultServerSnapshot(): boolean {
    return false;
}

/** The default-location chip's "×" — the one write path. No-ops if already
 *  set, so a second dismiss (e.g. a stale render) never double-notifies. */
export function suppressLocationDefault(): void {
    if (cache === true) return;
    cache = true;
    writeSuppressLocationDefault();
    notify();
}
