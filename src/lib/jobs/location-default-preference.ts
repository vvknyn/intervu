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
import { countryToFlag } from "./country-flag";

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

function clearSuppressLocationDefaultStorage(): void {
    if (!hasLocalStorage()) return;
    try {
        localStorage.removeItem(SUPPRESS_LOCATION_DEFAULT_KEY);
    } catch {
        /* ignore */
    }
}

/** Re-enable the IP default after a prior "×" dismiss — the location sheet's
 *  "Use detected location" affordance is the explicit opt back in. */
export function restoreLocationDefault(): void {
    if (cache === false) return;
    cache = false;
    clearSuppressLocationDefaultStorage();
    notify();
}

/**
 * G3 (Grok UX wave) — the ONE decision for whether the location control
 * shows the applied-default disclosure chip: the server actually applied a
 * default (`defaultedLocation` is set) AND the searcher has not chosen a
 * place of their own. Once they have, their choice takes over the control
 * and the chip would just be noise sitting on top of it. Pure so the
 * disclosure logic is testable without a DOM.
 *
 * Takes the CHOSEN places, not the location box's draft text. The draft was
 * an exact proxy only while the box itself was the state; now that the box
 * is an entry field for a list that can hold several places, an empty box no
 * longer means "no location" — it usually means "just committed one". Asking
 * the collection directly removes the second source of truth rather than
 * re-deriving the same fact from a control's transient contents.
 */
export function shouldShowLocationDefaultChip(
    defaultedLocation: string | null | undefined,
    chosenLocations: readonly string[],
): boolean {
    return !!defaultedLocation && chosenLocations.every((v) => v.trim().length === 0);
}

/** Country name for an ISO2 via the browser's own region-name table, with a
 *  bare-code fallback if `Intl.DisplayNames` throws. Single source for every
 *  "near {region}" label the applied-default disclosure renders — the
 *  desktop header-dock chip (`buildDockedChips` below), the mobile
 *  `DefaultLocationChip`, the zero-result entry, and the location sheet's
 *  detected-label all call this ONE function rather than each keeping its
 *  own copy of the same try/catch. */
export function regionDisplayName(iso2: string): string {
    try {
        return new Intl.DisplayNames(["en"], { type: "region" }).of(iso2) ?? iso2;
    } catch {
        return iso2;
    }
}

/** Stable key for the applied-location-default chip once it's dockable
 *  alongside ordinary filter chips (`buildDockedChips`) — round-trips back
 *  through `onClearChip` to `suppressLocationDefault`, the same "×" write
 *  path every other surface for this chip already uses. */
export const DEFAULT_LOCATION_CHIP_KEY = "default-location";

/** Same "near {region}" copy every applied-default surface uses — flag
 *  first when `countryToFlag` resolves one (most bare ISO2 codes won't; see
 *  country-flag.ts's removed-passthrough note), then the region name, with
 *  no leading space when there's no flag to prefix. */
function defaultLocationChipLabel(iso2: string): string {
    const name = regionDisplayName(iso2);
    const flag = countryToFlag(iso2);
    return flag ? `${flag} near ${name}` : `near ${name}`;
}

/**
 * The desktop header dock's chip list (`docked.chips`, TopBar.tsx) with the
 * applied-location-default chip PREPENDED when one is actually showing.
 * `defaultedIso2` is the caller's own `shouldShowLocationDefaultChip`
 * verdict collapsed to the ISO2 or `null` — this only shapes the array once
 * that's already decided. `null` returns `entryChips` unchanged (same
 * reference) so a render with nothing to disclose never fabricates a new
 * array for the dock effect to chase.
 */
export function buildDockedChips(
    defaultedIso2: string | null,
    entryChips: Array<{ key: string; label: string }>,
): Array<{ key: string; label: string }> {
    if (!defaultedIso2) return entryChips;
    return [{ key: DEFAULT_LOCATION_CHIP_KEY, label: defaultLocationChipLabel(defaultedIso2) }, ...entryChips];
}
