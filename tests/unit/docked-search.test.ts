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
const JOBS = read("src/app/jobs/JobsContent.tsx");
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
        // 98f2fee6 moved the row's classes into cn(...), so read every string literal.
        const row = [...TOPBAR.matchAll(/"([^"]*)"/g)].map((m) => m[1]).find((c) => c.includes("shell-row") && c.includes("--topbar-h"));
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
        // b1471917 (#534): the at-rest front door owns search, so lg+ docks
        // only once a search is active on the Search view.
        assert.match(src, /const headerDockActive = isLgUp && showSearchHome && !atRest;/);
    });

    it("the dock effect's dependency list carries no object/array literal — the React #185 guard", () => {
        // The case OTHER than `filterState` (the one that shipped the loop):
        // `activeEntries` is just as fresh a reference every render, and the
        // chips this effect now carries are built from it, so it is exactly
        // as easy to reach for here as `filterState` was originally.
        const src = stripComments(JOBS);
        // 12476231 put a For-you (`!showSearchHome`) clear ahead of the dock guard.
        const effect = src.match(/useEffect\(\(\) => {\s*(?:if \(!showSearchHome\) {\s*setDocked\(null\);\s*return;\s*}\s*)?if \(!headerDockActive\)[\s\S]*?}, \[([^\]]*)\]\);/);
        assert.ok(effect, "could not find the dock-setting effect");
        const deps = effect[1];
        assert.doesNotMatch(deps, /\bfilterState\b/, "an object literal here reintroduces the infinite-update loop");
        assert.doesNotMatch(deps, /\bactiveEntries\b/, "an array literal here reintroduces the infinite-update loop");
        assert.match(deps, /\bactiveChipsKey\b/, "chip content must be gated by a derived STRING, not the array itself");
    });
});

describe("dock chips: sourced from activeFilterEntries only", () => {
    it("the dock effect's chip list maps every active filter — there are no facet dropdowns to duplicate", () => {
        const src = stripComments(JOBS);
        assert.match(
            src,
            // 6feaf72c (#366) routes them through buildDockedChips, which prepends the location-default chip.
            /chips:\s*buildDockedChips\([^)]*activeEntries\.map\(\(entry\)\s*=>\s*\({\s*key:\s*entry\.key,\s*label:\s*chipLabelForEntry\(entry\)\s*}\)\)/,
            "header chips must map every entry of activeEntries: Filters is the one place to change them",
        );
        assert.doesNotMatch(src, /FacetBar|entriesNeedingOwnChip/);
    });

    it("the toolbar's own copy stands down once the header owns the search", () => {
        // Not a coexistence: `headerDockActive` gates the toolbar's chip row
        // and its filters-toggle the same way `isPristineLanding` gates the
        // hero search against the header — two live copies of "what's
        // active" is the duplicate-affordance regression this whole feature
        // was built to avoid repeating.
        const src = stripComments(JOBS);
        assert.match(src, /!headerDockActive && activeEntries\.length > 0/);
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
        // React Aria's Popover portals to the body and anchors to `triggerRef`.
        assert.match(read("src/components/search/SearchAutocomplete.tsx"), /<ComboboxPopover triggerRef=\{anchorRef\}/);
        assert.match(read("src/components/ui/combobox.tsx"), /<Popover[\s\S]*placement="bottom start"/);
    });

    it("centers docked clear controls in the field row", () => {
        const src = stripComments(JOBS);
        const queryBlock = src.slice(src.indexOf("const dockedQueryEl"), src.indexOf("const sortEl"));
        assert.match(queryBlock, /flex h-full w-full items-center/);
        // The query clear control is no longer a page-level sibling button —
        // SearchAutocomplete owns its own clear affordance (the `onClear`
        // prop) so the stacking contract lives with the field for every
        // caller, not with each page re-implementing one (see the mobile
        // jobs-search field's stacking bug this replaced).
        assert.match(
            queryBlock,
            /<SearchAutocomplete[\s\S]*?onClear=/,
            "the docked query field must delegate its clear control to SearchAutocomplete, not re-implement one",
        );
        assert.doesNotMatch(queryBlock, /topbar-docked-clear/, "a page-level clear button here would duplicate SearchAutocomplete's own");
    });
});

describe("docked search: mobile still owns nothing here", () => {
    it("the search field is lg-gated", () => {
        const searchPill = classNameForTestId(TOPBAR, "topbar-docked-search");
        assert.match(searchPill, /\blg:flex\b/, "the docked field must stay off below lg — the sticky mobile CTA owns search there");
    });

    it("the chips/Filters row exists and is lg-gated too", () => {
        assert.match(TOPBAR, /data-testid="topbar-docked-filters-toggle"/, "the header's Filters button must exist");
        // d254a782 (#421) made the row a `data-region="band"` wrapper; the lg gate lives there.
        const band = classNameForTestId(TOPBAR.replace('data-region="band"', 'data-testid="__band"'), "__band");
        assert.match(band, /\bhidden\b/, "the chips row's own wrapper must stay off below lg, same as the search field");
        assert.match(band, /\blg:block\b/, "the chips row's own wrapper must stay off below lg, same as the search field");
        assert.ok(TOPBAR.indexOf('data-region="band"') < TOPBAR.indexOf('data-testid="topbar-docked-filters-toggle"'), "the Filters button must live inside the lg-gated band");
    });
});
