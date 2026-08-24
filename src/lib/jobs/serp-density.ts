/**
 * Which shape /jobs takes at xl+, and where the facets live in each.
 *
 * Two layouts, one switch:
 *   comfortable — today's two-pane master/detail (list | detail). Facets are a
 *                 transient expand above the results.
 *   dense       — the classic three-pane faceted SERP (facets | list | detail).
 *                 The facets stop being transient and become a standing rail.
 *
 * Everything here is a DECISION, not paint. The class strings stay at the call
 * site in app/jobs/page.tsx, the same way `resolveDetailMountSite` names a
 * mount site and lets the component decide what that looks like. Keeping the
 * two apart is what makes the rules below testable without a DOM.
 *
 * The reason this file exists at all rather than a `dense` boolean threaded
 * through the page: the moment facets are permanently on screen, the "Filters"
 * expand is a SECOND copy of the same controls. That's not a styling detail,
 * it's a rule about which of three mount points is live — and a rule with three
 * outcomes and four inputs belongs somewhere it can be enumerated.
 */
import { readBrowserValue, writeBrowserValue } from "./browser-storage";

export type SerpDensity = "comfortable" | "dense";

export const SERP_DENSITY_KEY = "intervu.jobs.serpDensity";

/**
 * Comfortable, not dense. The dense rail is the new thing; defaulting to it
 * would re-lay-out /jobs for everyone who never asked, and the switch exists
 * precisely so that's a choice.
 */
export const DEFAULT_SERP_DENSITY: SerpDensity = "comfortable";

export function parseSerpDensity(raw: string | null | undefined): SerpDensity {
    return raw === "dense" || raw === "comfortable" ? raw : DEFAULT_SERP_DENSITY;
}

/**
 * Client-only. Called from an effect, never during render — reading storage
 * while rendering makes the server and the first client pass disagree, which
 * React reports as a hydration error rather than as the wrong layout.
 */
export function readSerpDensity(): SerpDensity {
    return parseSerpDensity(readBrowserValue(SERP_DENSITY_KEY));
}

export function writeSerpDensity(density: SerpDensity): void {
    writeBrowserValue(SERP_DENSITY_KEY, density);
}

/**
 * Where the facet controls render right now, or null for nowhere.
 *
 * `rail` is the only site that isn't gated on `filtersOpen` — a standing rail
 * has nothing to open. That asymmetry is the whole point: below xl the dense
 * layout has no rail to stand in, so it must fall through to exactly the same
 * inline/sheet behaviour comfortable has. Dense is an xl+ affordance and
 * nothing else; a narrow window renders byte-identically in both modes.
 */
export type FacetsMountSite = "rail" | "inline" | "sheet";

export function resolveFacetsMountSite(input: {
    density: SerpDensity;
    isXlUp: boolean;
    isLgUp: boolean;
    filtersOpen: boolean;
}): FacetsMountSite | null {
    if (input.density === "dense" && input.isXlUp) return "rail";
    if (!input.filtersOpen) return null;
    return input.isLgUp ? "inline" : "sheet";
}

/**
 * The "Filters" toggle is offering to reveal something already on screen
 * whenever the rail is up, so it stands down. Derived from the SAME call rather
 * than re-deriving `density === "dense" && isXlUp` at the button, or the two
 * can drift into a state where the button hides a panel that never mounted.
 */
export function showsFiltersToggle(site: FacetsMountSite | null): boolean {
    return site !== "rail";
}
