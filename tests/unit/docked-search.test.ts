import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The header's docked search, permanent as of 2026-08-24 (previously a
 * scroll-triggered button that only appeared once the hero search left the
 * viewport — see git history on this file for that mechanism's own guards).
 *
 * Two shapes this file locks in:
 *
 * 1. The dock now shows/hides on `isPristineLanding`, not on scroll — a
 *    scroll-position button reading "Search jobs" cannot accept typing, and
 *    "no header search at all until you scroll" is a worse first search than
 *    "present the moment one is active". The IntersectionObserver/
 *    `headerHeightPx`/`scroll-mt-*` machinery the OLD mechanism needed is
 *    gone with it — nothing in this file's rewritten dock effect scrolls
 *    anything into view any more, so a header-height token surviving in
 *    THAT machinery would be dead code pretending to matter.
 * 2. Chips in the header come from the SAME `activeFilterEntries` chokepoint
 *    the toolbar always used — never a hand-rolled second list. A
 *    hand-written enumeration beside that collection is exactly the bug
 *    that made `board=elite` invisible and capped search results (2026-08-24
 *    postmortem) — this guards the NEW call site the same way.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const CSS = read("src/app/globals.css");
const TOPBAR = read("src/components/layout/TopBar.tsx");
const JOBS = read("src/app/jobs/page.tsx");
const DOCK_CONTEXT = read("src/components/layout/SearchDockContext.tsx");

/** Source with JSX/block comments removed, so a number or word quoted in
 *  prose isn't read as code. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every `className="..."` value in a file. */
const classNamesIn = (src: string) => [...src.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);

/** The className of the element carrying `data-testid="<id>"`. */
function classNameForTestId(src: string, id: string): string {
    const at = src.indexOf(`data-testid="${id}"`);
    assert.notEqual(at, -1, `no element carries data-testid="${id}"`);
    const after = src.slice(at);
    const before = src.slice(0, at);
    const m = after.match(/className="([^"]*)"/) ?? before.match(/className="([^"]*)"$/);
    assert.ok(m, `data-testid="${id}" has no className`);
    return m[1];
}

describe("header height: the token is still the one source", () => {
    it("the token exists and the bar sizes itself from it", () => {
        assert.match(CSS, /--topbar-h:\s*\d+px;/, "globals.css must define the header height once");
        const row = classNamesIn(TOPBAR).find((c) => c.includes("shell-row") && c.includes("--topbar-h"));
        assert.ok(row, "TopBar's primary row must take its height FROM the token");
        assert.doesNotMatch(row, /\bh-\d/, "a literal height lets the bar drift from every offset derived from it");
    });

    it("the old scroll-to-hero machinery is gone, not left dead", () => {
        // The permanent dock (2026-08-24) is present the moment a search is
        // active — nothing scrolls the hero back into view any more, so a
        // header-height helper measuring it for that purpose would be unused
        // code carrying a false "this still matters" signal. Their removal
        // is part of this change, not incidental. (This file still has an
        // unrelated IntersectionObserver for infinite-scroll pagination —
        // that one stays; only the dock-specific helpers are asserted gone.)
        assert.doesNotMatch(stripComments(JOBS), /headerHeightPx/, "the scroll-clearance helper is dead — remove it, don't strand it");
        assert.doesNotMatch(stripComments(JOBS), /searchOutOfView/, "the scroll-triggered dock state is dead — remove it, don't strand it");
    });
});

describe("dock trigger: presence follows the search, not scroll position", () => {
    it("the dock effect gates on the pristine-landing fact, not a scroll flag", () => {
        const src = stripComments(JOBS);
        assert.match(
            src,
            /if \(!headerDockActive\)\s*{\s*setDocked\(null\);/,
            "the dock must clear on the SAME fact the hero/toolbar use to stand down, not a re-derived condition",
        );
        // lg+ always docks — pristine landing uses the header search too.
        assert.match(src, /const headerDockActive = isLgUp;/);
    });

    it("the dock effect's dependency list carries no object/array literal — the React #185 guard", () => {
        // The case OTHER than `filterState` (the one that shipped the loop):
        // `activeEntries` is just as fresh a reference every render, and the
        // chips this effect now carries are built from it, so it is exactly
        // as easy to reach for here as `filterState` was originally.
        const src = stripComments(JOBS);
        const effect = src.match(/useEffect\(\(\) => {\s*if \(!headerDockActive\)[\s\S]*?}, \[([^\]]*)\]\);/);
        assert.ok(effect, "could not find the dock-setting effect");
        const deps = effect[1];
        assert.doesNotMatch(deps, /\bfilterState\b/, "an object literal here reintroduces the infinite-update loop");
        assert.doesNotMatch(deps, /\bactiveEntries\b/, "an array literal here reintroduces the infinite-update loop");
        assert.match(deps, /\bactiveChipsKey\b/, "chip content must be gated by a derived STRING, not the array itself");
    });
});

describe("dock chips: sourced from activeFilterEntries only", () => {
    it("the dock effect's chip list maps FacetBar leftovers — not duplicates of dropdown chips", () => {
        const src = stripComments(JOBS);
        assert.match(
            src,
            /chips:\s*unnamedEntries\.map\(\(entry\)\s*=>\s*\({\s*key:\s*entry\.key,\s*label:\s*chipLabelForEntry\(entry\)\s*}\)\)/,
            "header chips must use entriesNeedingOwnChip(activeEntries) so FacetBar-owned filters are not duplicated",
        );
        assert.match(src, /entriesNeedingOwnChip\(activeEntries, facetBarRepresents/);
    });

    it("the toolbar's own copy stands down once the header owns the search", () => {
        // Not a coexistence: `headerDockActive` gates the toolbar's chip row
        // and its filters-toggle the same way `isPristineLanding` gates the
        // hero search against the header — two live copies of "what's
        // active" is the duplicate-affordance regression this whole feature
        // was built to avoid repeating.
        const src = stripComments(JOBS);
        assert.match(src, /!headerDockActive && unnamedEntries\.map/);
        assert.match(src, /showsFiltersToggle\(facetsMountSite\) && !headerDockActive/);
    });
});

describe("docked search: controlled input, not a scroll-to button", () => {
    it("the context contract is a controlled field, no onExpand", () => {
        assert.match(DOCK_CONTEXT, /value:\s*string/);
        assert.match(DOCK_CONTEXT, /onChange:\s*\(value:\s*string\)\s*=>\s*void/);
        assert.match(DOCK_CONTEXT, /onSubmit:\s*\(value:\s*string\)\s*=>\s*void/);
        assert.doesNotMatch(DOCK_CONTEXT, /onExpand/, "the scroll-back handle is gone — the field is real now, nothing to expand");
    });

    it("still doesn't know what a job search is", () => {
        // The seam this whole feature has to preserve: no "job"/"Meili"/
        // "facet" vocabulary in the actual TYPE TopBar renders against — the
        // doc comment names them deliberately to explain the boundary, so
        // only the stripped source (the real contract) is checked here.
        const type = DOCK_CONTEXT.slice(DOCK_CONTEXT.indexOf("export type DockedSearchChip"));
        assert.doesNotMatch(type, /\bjob\b/i);
        assert.doesNotMatch(type, /meili/i);
        assert.doesNotMatch(type, /\bfacet\b/i);
    });

    it("grows into the space rather than sitting in a fixed cap", () => {
        const pill = classNameForTestId(TOPBAR, "topbar-docked-search");
        assert.match(pill, /\bflex-1\b/, "the docked search must absorb the bar's leftover width");
        assert.doesNotMatch(pill, /\bmax-w-/, "a width cap is what left the empty gap beside it");
        assert.match(pill, /\bmin-w-0\b/, "without min-w-0 a flex child refuses to shrink and overflows the bar");
    });

    it("its row hands it that width instead of pooling it as a gap", () => {
        // The other half of the same fix: `flex-1` on the field is inert if
        // the row it sits in is only as wide as its contents.
        const cluster = classNamesIn(TOPBAR).find(
            (c) => /\bflex-1\b/.test(c) && /\bjustify-end\b/.test(c) && !c.includes("shell-row"),
        );
        assert.ok(cluster, "the bar's right-hand row must claim the free width for the docked search to fill");
        assert.match(cluster, /\bmin-w-0\b/, "the row must be allowed to shrink below its content width");
    });

    it("wears the search field's chrome, not a label's", () => {
        const pill = classNameForTestId(TOPBAR, "topbar-docked-search");
        assert.match(pill, /\bbg-card\b/, "a search box sits on the card ground the real field uses");
        assert.match(pill, /\bborder\b/, "a search box has a visible edge");
    });

    it("does not clip typeahead — overflow-hidden swallows absolute dropdowns", () => {
        const pill = classNameForTestId(TOPBAR, "topbar-docked-search");
        assert.doesNotMatch(pill, /\boverflow-hidden\b/, "query and location suggestions hang below the field");
        assert.match(pill, /\boverflow-visible\b/);
    });

    it("portals suggestion lists so clipped ancestors cannot hide them", () => {
        const location = read("src/components/jobs/LocationCombobox.tsx");
        const search = read("src/components/search/SearchAutocomplete.tsx");
        assert.match(location, /createPortal[\s\S]*document\.body/);
        assert.match(search, /createPortal[\s\S]*document\.body/);
        assert.match(location, /useAnchoredOverlayRect/);
        assert.match(search, /useAnchoredOverlayRect/);
    });

    it("centers docked clear controls in the field row", () => {
        const src = stripComments(JOBS);
        const queryBlock = src.slice(src.indexOf("const dockedQueryEl"), src.indexOf("const dockedLocationEl"));
        const locationBlock = src.slice(src.indexOf("const dockedLocationEl"), src.indexOf("const sortEl"));
        assert.match(queryBlock, /flex h-full w-full items-center/);
        assert.match(queryBlock, /topbar-docked-clear[\s\S]*self-center/);
        assert.match(locationBlock, /flex h-full w-full items-center/);
        assert.match(locationBlock, /topbar-docked-location-clear[\s\S]*self-center/);
        const comboAt = src.indexOf("const dockedLocationEl");
        const combo = src.slice(comboAt, src.indexOf("const sortEl"));
        assert.match(combo, /containerClassName="[^"]*flex-1/, "w-full on the combobox shoves the clear onto Search");
        assert.doesNotMatch(combo, /containerClassName="[^"]*\bw-full\b/);
    });
});

describe("docked search: mobile still owns nothing here", () => {
    it("the search field is lg-gated", () => {
        const searchPill = classNameForTestId(TOPBAR, "topbar-docked-search");
        assert.match(searchPill, /\blg:flex\b/, "the docked field must stay off below lg — the sticky mobile CTA owns search there");
    });

    it("the chips/Filters row exists and is lg-gated too", () => {
        assert.match(TOPBAR, /data-testid="topbar-docked-filters-toggle"/, "the header's Filters button must exist");
        const wrapper = classNamesIn(TOPBAR).find((c) => c.includes("border-t") && c.includes("lg:block"));
        assert.ok(wrapper, "the chips row's own wrapper must stay off below lg, same as the search field");
    });
});
