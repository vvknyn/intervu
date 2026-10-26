import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JOBS_USP } from "../../src/lib/jobs/jobs-usp-copy";
import { EXCEPTION_KEY_BODY, EXCEPTION_KEY_TITLE } from "../../src/lib/jobs/row-exception";
import { tourSteps } from "../../src/components/tour/tour-steps";
import { NAV_TABS } from "../../src/components/layout/nav-tabs";

const PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "JobsContent.tsx");
const JOBS_ACTIONS = join(__dirname, "..", "..", "src", "actions", "jobs.ts");
const TOPBAR = join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx");
const FOOTER = join(__dirname, "..", "..", "src", "components", "layout", "Footer.tsx");
const TABS = join(__dirname, "..", "..", "src", "components", "ui", "tabs.tsx");
const MOBILE_TABBAR = join(__dirname, "..", "..", "src", "components", "layout", "MobileTabBar.tsx");
const JOBCARD = join(__dirname, "..", "..", "src", "components", "jobs", "JobCard.tsx");
const YOURS_PAGE = join(__dirname, "..", "..", "src", "app", "yours", "page.tsx");
const SPLASH = join(__dirname, "..", "..", "src", "components", "jobs", "JobsListSplash.tsx");

describe("jobs USP copy: single source for tour and landing", () => {
    it("exports the five marketing claims", () => {
        assert.equal(JOBS_USP.mastheadTitle, "Every job, straight from the employer.");
        assert.doesNotMatch(JOBS_USP.searchDescription, /^Every job, straight from the employer\./);
        assert.match(JOBS_USP.searchDescription, /screened for stale postings/);
        assert.equal(JOBS_USP.straightFromCompany.title, "Straight from the company");
        assert.ok(JOBS_USP.straightFromCompany.body.length > 20);
        assert.equal(JOBS_USP.checkedBeforeApply.title, "Checked before you apply");
        assert.ok(JOBS_USP.checkedBeforeApply.body.length > 20);
        assert.equal(JOBS_USP.realPay.title, "Real pay, not estimates");
        assert.ok(JOBS_USP.realPay.body.length > 20);
        assert.equal(JOBS_USP.connect.title, "MCP and local agents");
        assert.match(JOBS_USP.connect.body, /Agents/i);
        assert.match(JOBS_USP.connect.body, /MCP/i);
        assert.match(JOBS_USP.connect.body, /local agent/i);
        assert.doesNotMatch(JOBS_USP.connect.body, /outreach/i);
        assert.doesNotMatch(JOBS_USP.connect.body, /hiring managers/i);
        assert.doesNotMatch(JOBS_USP.connect.body, /recruiters/i);
    });

    it("tourSteps.jobs titles and descriptions derive from JOBS_USP", () => {
        // The straightFromCompany / `jobs-card` step was dropped from the
        // guided tour (JOBS_USP.straightFromCompany is still exported and
        // used elsewhere, e.g. the landing showcase, just no longer as a
        // tour stop) — five steps, not six.
        const steps = tourSteps.jobs;
        assert.ok(steps, "jobs tour steps must exist");
        assert.equal(steps.length, 5);

        assert.equal(steps[0].selector, '[data-tour="jobs-search"]');
        assert.equal(steps[0].title, "Start with a search");
        assert.equal(steps[0].description, JOBS_USP.searchDescription);

        assert.equal(steps[1].selector, '[data-tour="row-exception"]');
        assert.equal(steps[1].title, EXCEPTION_KEY_TITLE);
        assert.equal(steps[1].description, EXCEPTION_KEY_BODY);
        assert.match(EXCEPTION_KEY_BODY, /\.$/);
        assert.equal(steps[1].optional, true);

        assert.equal(steps[2].selector, '[data-tour="jobs-posting-check"]');
        assert.equal(steps[2].title, JOBS_USP.checkedBeforeApply.title);
        assert.equal(steps[2].description, JOBS_USP.checkedBeforeApply.body);
        assert.equal(steps[2].optional, true);

        assert.equal(steps[3].selector, '[data-tour="jobs-pay"]');
        assert.equal(steps[3].title, JOBS_USP.realPay.title);
        assert.equal(steps[3].description, JOBS_USP.realPay.body);
        assert.equal(steps[3].optional, true);

        assert.equal(steps[4].selector, '[data-tour="nav-connect"]');
        assert.equal(steps[4].title, JOBS_USP.connect.title);
        assert.equal(steps[4].description, JOBS_USP.connect.body);
        assert.equal(steps[4].optional, true);
    });
});

describe("header nav", () => {
    it("is one underline-tab row: no dropdown, every NAV_TABS entry a TabItem link", () => {
        const src = readFileSync(TOPBAR, "utf8");
        assert.doesNotMatch(src, /DropdownMenu(Trigger|Content)/);
        assert.match(src, /<TabNav\b[\s\S]*<TabItem\b[\s\S]*asChild/);
        const resume = NAV_TABS.find((t) => t.testId === "topbar-resume");
        assert.equal(resume?.label, "Add résumé");
        assert.equal(resume?.href, "/resume");
        assert.equal(resume?.tourSelector, "nav-connect");
    });

    it("TopBar has no theme control — product is dark-only", () => {
        const src = readFileSync(TOPBAR, "utf8");
        assert.doesNotMatch(src, /useTheme/);
        assert.doesNotMatch(src, /Dark mode/);
        assert.doesNotMatch(src, /toggleMode/);
    });

    it("signed-out footer has no theme toggle (dark-only invariant)", () => {
        const footer = readFileSync(FOOTER, "utf8");
        assert.doesNotMatch(footer, /toggleMode/);
        assert.doesNotMatch(footer, /Dark mode/);
        assert.match(footer, /bg-background/);
        assert.doesNotMatch(footer, /siteChrome/);
        assert.doesNotMatch(footer, /bg-chrome/);
    });

    it("MobileTabBar forwards tourSelector as data-tour", () => {
        const src = readFileSync(MOBILE_TABBAR, "utf8");
        assert.match(src, /data-tour=\{tab\.tourSelector\}/);
    });

    it("MobileTabBar paints glass material (calm pass R4), not ink siteChrome", () => {
        const src = readFileSync(MOBILE_TABBAR, "utf8");
        assert.match(src, /material-bar/);
        assert.doesNotMatch(src, /siteChrome/);
        assert.doesNotMatch(src, /bg-chrome/);
    });

    it("MobileTabBar tab links use CHROME_FOCUS_VISIBLE for keyboard focus", () => {
        const src = readFileSync(MOBILE_TABBAR, "utf8");
        assert.match(src, /CHROME_FOCUS_VISIBLE/);
        assert.match(src, /rounded-ctl/);
        assert.doesNotMatch(src, /focus-visible:ring-/);
    });

    it("TopBar primary nav links take their focus ring from the shared tab primitive", () => {
        const src = readFileSync(TOPBAR, "utf8");
        const navLinks = src.slice(src.indexOf("{navTabs.map"), src.indexOf("</TabNav>", src.indexOf("{navTabs.map")));
        assert.match(navLinks, /<TabItem\b/);
        assert.doesNotMatch(navLinks, /focus-visible:ring-/);
        assert.match(readFileSync(TABS, "utf8"), /focus-visible:outline-2/);
    });

    it("TopBar paints paper chrome, not ink siteChrome", () => {
        const src = readFileSync(TOPBAR, "utf8");
        assert.doesNotMatch(src, /siteChrome/);
        assert.doesNotMatch(src, /bg-chrome/);
    });

    it("Tracker empty CTA uses default brand Button, not charcoal fill", () => {
        const src = readFileSync(YOURS_PAGE, "utf8");
        const emptyCta = src.slice(src.indexOf("Browse verified roles") - 200, src.indexOf("Browse verified roles") + 80);
        assert.doesNotMatch(emptyCta, /bg-slate-900/);
    });
});

describe("tours never auto-start", () => {
    const page = readFileSync(PAGE, "utf8");

    it("the jobs page starts a tour only from the explicit \"?\" button", () => {
        const calls = page.match(/startTour\(/g) ?? [];
        assert.equal(calls.length, 1, "a second startTour( call is an auto-start path");
        assert.match(page, /onClick=\{\(\) => startTour\(\)\}/);
    });

    it("no first-visit or exception coachmark can be queued by the page", () => {
        assert.doesNotMatch(page, /pickExceptionJit|requestAnimationFrame\(\(\) => startTour/);
        for (const id of ["jobs-relist", "jobs-stale", "jobs-exception-both"]) assert.equal(tourSteps[id], undefined, id);
    });
});

describe("jobs page chrome guards", () => {
    it("uses a 20-row first fetch window mirrored in the server browse action", () => {
        const pageSrc = readFileSync(PAGE, "utf8");
        const actionsSrc = readFileSync(JOBS_ACTIONS, "utf8");
        assert.match(pageSrc, /const PAGE = 20;/);
        assert.match(actionsSrc, /const DEFAULT_BROWSE_LIMIT = 20;/);
    });

    it("does not render LandingUspSection on the page", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.doesNotMatch(src, /<LandingUspSection/);
    });

    it("signed-out TopBar: one Sign in + Create account pair on every surface; one auth system", () => {
        const src = readFileSync(TOPBAR, "utf8");
        const start = src.indexOf('authChrome === "pending"');
        assert.notStrictEqual(start, -1, "auth chrome branch not found in TopBar");
        const authBlock = src.slice(start, src.indexOf("<AuthPopover"));
        assert.match(authBlock, /topbar-signin/);
        assert.match(authBlock, /topbar-create-account/);
        assert.doesNotMatch(src, /topbar-alerts-cta/);
        assert.doesNotMatch(authBlock, /leanSurface/, "the auth pair does not vary by surface");
        // The defect this replaced was a SECOND auth component rendering its
        // own session check and its own button beside the popover's, so the
        // two could disagree on screen. Naming the old component here would
        // only have banned that one instance — this bans the shape: nothing
        // in the bar may resolve auth except `onAuthChange` above.
        assert.doesNotMatch(src, /useAuth\(/);
        assert.strictEqual(src.match(/<AuthPopover/g)?.length, 1);
    });

    it("TopBar reserves the auth slot instead of claiming signed-out before auth resolves", () => {
        const src = readFileSync(TOPBAR, "utf8");
        // `null` alone would mean both "signed out" and "not asked yet", and
        // `onAuthChange` waits on a server round-trip for the httpOnly WorkOS
        // cookie — so the undefined seed is what keeps a signed-in user from
        // being shown a Sign-in button mid-flight.
        assert.match(src, /useState<User \| null \| undefined>\(undefined\)/);
        const pending = src.slice(
            src.indexOf('authChrome === "pending"'),
            src.indexOf('authChrome === "authenticated" && user'),
        );
        assert.doesNotMatch(pending, /topbar-signin|topbar-create-account/);
        assert.match(pending, /topbar-auth-pending/);
    });

    it("SERP renders exactly one h1 — masthead branch or sr-only fallback, never both", () => {
        // Advanced-search home: `{atRest ? visible masthead : sr-only}` inside
        // one gate; every other search-home path falls back to a single sr-only
        // h1 (or null at rest on the non-advanced branch). At most one h1
        // mounts — guarded by mutually exclusive ternary arms, not two heroes.
        const src = readFileSync(PAGE, "utf8");
        const advancedGate = src.indexOf("{showSearchHome ? ("); // #652 (f6a8e9cc) dropped showAdvancedSearch; the onboarding card's gate went with the card
        assert.notStrictEqual(advancedGate, -1, "advanced-search masthead gate moved — update this test");
        const atRestMasthead = src.indexOf("{atRest ? (", advancedGate);
        assert.notStrictEqual(atRestMasthead, -1, "at-rest masthead ternary moved — update this test");
        // a0e046d7: the visible masthead h1 is the shared <PageTitle> (heading.tsx renders <h1>).
        const visibleH1 = src.indexOf("<PageTitle>", atRestMasthead);
        assert.notStrictEqual(visibleH1, -1, "visible masthead h1 moved — update this test");
        const srOnlyH1 = '<h1 className="sr-only">Jobs</h1>';
        assert.ok((src.match(new RegExp(srOnlyH1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length >= 2);
        const h1Count = (src.match(/<(h1|PageTitle)[\s>]/g) || []).length;
        assert.equal(h1Count, 3, "visible masthead h1 + two sr-only fallback literals");
    });

    it("loading splash copy uses readable status text size", () => {
        // acb97835 extracted the splash to components/jobs/JobsListSplash.tsx.
        const splash = readFileSync(SPLASH, "utf8");
        assert.match(splash, /Finding live roles/);
        assert.doesNotMatch(splash, /text-\[11px\]/);
    });

    it("Sort is no longer portalled into the docked TopBar: it lives on the results line", () => {
        const page = readFileSync(PAGE, "utf8");
        assert.doesNotMatch(page, /topbar-docked-sort|createPortal\(\s*sortEl/);
    });

    it("browse-by-field portals into the docked TopBar filter row", () => {
        const page = readFileSync(PAGE, "utf8");
        const topbar = readFileSync(TOPBAR, "utf8");
        assert.match(topbar, /data-testid="topbar-docked-field-directory"/);
        assert.match(page, /topbar-docked-field-directory/);
        assert.match(page, /createPortal\(fieldDirectoryMenu/);
        assert.match(page, /createPortal\(clearFiltersEl/);
        // The docked save-search mount carries `savedSearchMountEl`, a
        // fragment of the résumé band word (`rankByFitEl`) then the save-
        // search panel (`savedSearchControl`) — not `savedSearchControl`
        // alone, so a résumé-less guest sees the entry even when
        // `canSaveSearch` is false and `savedSearchControl` is null.
        assert.doesNotMatch(page, /savedSearchMountEl|topbar-docked-save-search/);
        assert.match(topbar, /data-testid="topbar-docked-clear-filters"/);
        const dockedRow = topbar.slice(
            topbar.indexOf('data-testid="topbar-docked-filters-toggle"'),
            topbar.indexOf('data-testid="topbar-docked-extras"'),
        );
        const filtersIdx = dockedRow.indexOf("topbar-docked-filters-toggle");
        const fieldIdx = dockedRow.indexOf("topbar-docked-field-directory");
        const facetsIdx = dockedRow.indexOf("topbar-docked-facets");
        const clearIdx = dockedRow.indexOf("topbar-docked-clear-filters");
        const saveIdx = dockedRow.indexOf("topbar-docked-save-search");
        const chipIdx = dockedRow.indexOf("topbar-docked-chip");
        const sortIdx = dockedRow.indexOf("topbar-docked-sort");
        const spacerIdx = dockedRow.indexOf('min-w-0 flex-1');
        assert.ok(filtersIdx > -1 && filtersIdx < fieldIdx, "Filters toggle leads the left cluster");
        assert.ok(fieldIdx > -1 && facetsIdx > fieldIdx, "Browse by field mounts before facets");
        assert.ok(filtersIdx < facetsIdx, "Filters toggle must not sit between field and facets");
        assert.ok(chipIdx > facetsIdx, "Leftover filter chips mount after facet dropdowns");
        assert.ok(clearIdx > chipIdx, "Clear filters mounts at the trailing end of the chip cluster");
        assert.ok(filtersIdx < clearIdx && clearIdx < spacerIdx, "Filters toggle before Clear, Clear before spacer");
        assert.ok(saveIdx > spacerIdx, "Save search is after the flex spacer");
        assert.doesNotMatch(topbar, /topbar-docked-status/, "live corpus count deferred from docked toolbar");
        assert.ok(sortIdx > saveIdx, "Sort segments mount after save search");
    });

    it("jobs tour replay uses the shared toolbar height token", () => {
        const src = readFileSync(PAGE, "utf8");
        const replay = src.slice(
            src.indexOf("function JobsTourReplayButton"),
            src.indexOf("function JobCardSkeleton"),
        );
        assert.match(replay, /toolbarControlHeight/);
        assert.doesNotMatch(replay, /h-9 w-9/);
    });

    it("mounts the masthead's eyebrow, headline and subline when at rest — no display-size count", () => {
        // Was the "does not render LandingMasthead" guard for the OLD bug
        // (component authored, never mounted). The masthead is now inline
        // markup absorbed at this callsite — assert its real content mounts
        // instead of asserting a component name that no longer exists.
        // Front-door redesign: the gate broadened from `showLandingMarketing`
        // to `atRest`. Design pass D1 (2026-09-17, Fable): the masthead's own
        // display-size `resultCountLine` was CUT — redundant with the
        // identical line already heading the results list below (still
        // asserted present there, and NOT `liveCountEl`, which stays at the
        // end of the results list, asserted absent from this branch
        // elsewhere).
        const src = readFileSync(PAGE, "utf8");
        const advancedGate = src.indexOf("{showSearchHome ? ("); // #652 (f6a8e9cc) dropped showAdvancedSearch; the onboarding card's gate went with the card
        assert.notStrictEqual(advancedGate, -1);
        const atRestMasthead = src.indexOf("{atRest ? (", advancedGate);
        assert.notStrictEqual(atRestMasthead, -1);
        const end = src.indexOf('<h1 className="sr-only">Jobs</h1>', atRestMasthead);
        assert.notStrictEqual(end, -1);
        const branch = src.slice(atRestMasthead, end);
        assert.match(branch, /Live from employer career pages/);
        assert.match(branch, /JOBS_USP\.mastheadTitle/);
        assert.match(branch, /JOBS_USP\.searchDescription/);
        assert.doesNotMatch(branch, /\{resultCountLine\}/, "the hero's own count line was cut (D1) — it duplicated the results list heading");
    });

    it("lg+ docks search in the header whenever search is the active home view, except at rest", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /const headerDockActive = isLgUp && showSearchHome && !atRest;/);
    });

    it("does not render the comfortable/dense layout switch", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.doesNotMatch(src, /serp-density-switch/);
        assert.doesNotMatch(src, /chooseDensity/);
    });

    it("collapses the in-page jobs-toolbar when header owns every control", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /showJobsToolbarSection/);
        assert.match(src, /showJobsToolbarRow/);
        assert.match(src, /headerDockActive\s*\?\s*"pt-\[var\(--jobs-bar-content-gap\)\]/);
    });

    it("loads 20 rows before the show-more control", () => {
        const page = readFileSync(PAGE, "utf8");
        const actions = readFileSync(JOBS_ACTIONS, "utf8");
        assert.match(page, /const PAGE = 20;/);
        assert.match(actions, /const DEFAULT_BROWSE_LIMIT = 20;/);
        assert.match(actions, /\["jobs-default-browse", String\(DEFAULT_BROWSE_LIMIT\)\]/);
    });

    it("JobCard uses word marks, not TRUST_CHIP glyphs", () => {
        const jobCard = readFileSync(JOBCARD, "utf8");
        assert.doesNotMatch(jobCard, /TRUST_CHIP/);
        assert.doesNotMatch(jobCard, /✕/);
        assert.doesNotMatch(jobCard, /⟳/);
        assert.match(jobCard, /rowExceptionMark/);
        assert.match(jobCard, /data-exception=\{exceptionMark\.kind\}/);
        assert.match(jobCard, /data-testid="row-exception"/);
    });

    it("TourProvider resolves visible tour targets, not hidden duplicates", () => {
        const src = readFileSync(
            join(__dirname, "..", "..", "src", "components", "tour", "TourProvider.tsx"),
            "utf8",
        );
        assert.match(src, /export function visibleTourTarget/);
        assert.doesNotMatch(src, /document\.querySelector\(step\.selector\)/);
    });

    it("deduplicates save search when the toolbar row is showing", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.doesNotMatch(src, /!showJobsToolbarRow && savedSearchControl/);
        assert.match(src, /\{savedSearchControl\}/);
    });

    it("has no facet dropdown bar: Filters is the one entry point", () => {
        const src = readFileSync(PAGE, "utf8");
        const toolbar = src.slice(src.indexOf('data-testid="jobs-toolbar"'), src.indexOf('data-testid="active-filter-row"'));
        assert.doesNotMatch(toolbar, /facetBarEl|<FilterChipsRow/);
    });

    it("mounts the filter toolbar before Browse by field on the landing", () => {
        const src = readFileSync(PAGE, "utf8");
        const toolbarIdx = src.indexOf('data-testid="jobs-toolbar"');
        const fieldLinksIdx = src.indexOf("<FrontDoorFieldLinks");
        assert.ok(toolbarIdx > -1 && fieldLinksIdx > toolbarIdx, "jobs-toolbar precedes FrontDoorFieldLinks");
    });

});
