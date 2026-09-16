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
 * G3 (Grok UX wave) — the ONE decision for whether the geo default is still
 * in effect: the server actually applied a default (`defaultedLocation` is
 * set) AND the searcher has not chosen a place of their own. Once they have,
 * their choice takes over the control. Pure so the disclosure logic is
 * testable without a DOM.
 *
 * Shared chokepoint, not just the toolbar chip's gate: `locationTriggerLabel`
 * (lib/jobs/location-label.ts) calls this exact function too, so the chip
 * and the mobile trigger can never disagree about whether the default is
 * showing (PR #461 review BLOCKER — they used to each keep their own
 * check). Deliberately has no `work_type`/remote check, matching the
 * server's own `hasLocationSignal` (lib/geo/ip-default.ts), which doesn't
 * check it either — a remote-only pick doesn't suppress the default
 * server-side.
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

/**
 * Names the scope a geo-defaulted search actually queried — the single
 * source every "near {region}" label (below, plus jobs/page.tsx's
 * `DefaultLocationChip`, its zero-result entry, and location-label.ts's
 * `detectedLocationLabel`) derives its wording from, instead of each one
 * independently deciding whether to mention remote.
 *
 * `remoteAnywhere` is `JobSearchResult.remoteAnywhere` (search.ts) — read off
 * the SAME `PlaceClause.remoteAnywhere` flag `buildFilter` (meilisearch.ts)
 * itself uses to OR `REMOTE_ANYWHERE_CLAUSE` into the applied place filter,
 * never re-derived from country names or the word "remote" as a string
 * match. A country-level geo default sets it unconditionally today
 * (resolve-place.ts's `placeClause`), so every one of these chips used to
 * read "near Canada" over a result set that also included Sydney/Dubai/Costa
 * Rica remote listings — true of the country clause alone, false of the
 * query that actually ran. Naming the OR keeps the label honest without
 * hardcoding that correlation.
 */
export function locationDefaultScope(iso2: string, remoteAnywhere: boolean | undefined): string {
    const name = regionDisplayName(iso2);
    return remoteAnywhere ? `${name} or remote` : name;
}

/** Same "near {region}" copy every applied-default surface uses — flag
 *  first when `countryToFlag` resolves one (most bare ISO2 codes won't; see
 *  country-flag.ts's removed-passthrough note), then the scope name, with
 *  no leading space when there's no flag to prefix. */
function defaultLocationChipLabel(iso2: string, remoteAnywhere: boolean | undefined): string {
    const scope = locationDefaultScope(iso2, remoteAnywhere);
    const flag = countryToFlag(iso2);
    return flag ? `${flag} near ${scope}` : `near ${scope}`;
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
    remoteAnywhere: boolean | undefined,
    entryChips: Array<{ key: string; label: string }>,
): Array<{ key: string; label: string }> {
    if (!defaultedIso2) return entryChips;
    return [
        { key: DEFAULT_LOCATION_CHIP_KEY, label: defaultLocationChipLabel(defaultedIso2, remoteAnywhere) },
        ...entryChips,
    ];
}
