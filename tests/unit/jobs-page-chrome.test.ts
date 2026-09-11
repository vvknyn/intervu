import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JOBS_USP } from "../../src/lib/jobs/jobs-usp-copy";
import { RELISTED_EXPLAIN } from "../../src/lib/jobs/relisted-explain";
import { EXCEPTION_KEY_BODY, EXCEPTION_KEY_TITLE } from "../../src/lib/jobs/row-exception";
import { GHOST_META } from "../../src/lib/jobs/presentation";
import { pickExceptionJit, shouldShowRelistJit } from "../../src/lib/jobs/should-show-relist-jit";
import { tourSteps } from "../../src/components/tour/tour-steps";
import { NAV_TABS } from "../../src/components/layout/nav-tabs";

const PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "page.tsx");
const JOBS_ACTIONS = join(__dirname, "..", "..", "src", "actions", "jobs.ts");
const TOUR_TRIGGER = join(__dirname, "..", "..", "src", "components", "tour", "TourTrigger.tsx");
const TOPBAR = join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx");
const FOOTER = join(__dirname, "..", "..", "src", "components", "layout", "Footer.tsx");
const MOBILE_TABBAR = join(__dirname, "..", "..", "src", "components", "layout", "MobileTabBar.tsx");
const YOURS_PAGE = join(__dirname, "..", "..", "src", "app", "yours", "page.tsx");

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
        const steps = tourSteps.jobs;
        assert.ok(steps, "jobs tour steps must exist");
        assert.equal(steps.length, 6);

        assert.equal(steps[0].selector, '[data-tour="jobs-search"]');
        assert.equal(steps[0].title, JOBS_USP.mastheadTitle);
        assert.equal(steps[0].description, JOBS_USP.searchDescription);

        assert.equal(steps[1].selector, '[data-tour="jobs-card"]');
        assert.equal(steps[1].title, JOBS_USP.straightFromCompany.title);
        assert.equal(steps[1].description, JOBS_USP.straightFromCompany.body);

        assert.equal(steps[2].selector, '[data-tour="row-exception"]');
        assert.equal(steps[2].title, EXCEPTION_KEY_TITLE);
        assert.equal(steps[2].description, EXCEPTION_KEY_BODY);
        assert.match(EXCEPTION_KEY_BODY, /\.$/);
        assert.equal(steps[2].optional, true);

        assert.equal(steps[3].selector, '[data-tour="jobs-posting-check"]');
        assert.equal(steps[3].title, JOBS_USP.checkedBeforeApply.title);
        assert.equal(steps[3].description, JOBS_USP.checkedBeforeApply.body);
        assert.equal(steps[3].optional, true);

        assert.equal(steps[4].selector, '[data-tour="jobs-pay"]');
        assert.equal(steps[4].title, JOBS_USP.realPay.title);
        assert.equal(steps[4].description, JOBS_USP.realPay.body);
        assert.equal(steps[4].optional, true);

        assert.equal(steps[5].selector, '[data-tour="nav-connect"]');
        assert.equal(steps[5].title, JOBS_USP.connect.title);
        assert.equal(steps[5].description, JOBS_USP.connect.body);
        assert.equal(steps[5].optional, true);
    });
});

describe("nav tab placement", () => {
    it("clusters Jobs, Resume, Tracker in menu; Agents stays on the bar", () => {
        const jobs = NAV_TABS.find((t) => t.testId === "topbar-jobs");
        const resume = NAV_TABS.find((t) => t.testId === "topbar-resume");
        const tracker = NAV_TABS.find((t) => t.testId === "topbar-tracker");
        const agents = NAV_TABS.find((t) => t.testId === "topbar-connect");
        assert.equal(jobs?.placement, "menu");
        assert.equal(resume?.placement, "menu");
        assert.equal(tracker?.placement, "menu");
        assert.equal(agents?.placement, "bar");
        assert.equal(agents?.label, "Agents");
        assert.equal(agents?.tourSelector, "nav-connect");
    });

    it("TopBar has no standalone theme button in the header cluster", () => {
        const src = readFileSync(TOPBAR, "utf8");
        const headerCluster = src.slice(src.indexOf('aria-label="Primary"'), src.indexOf("{user ?"));
        assert.doesNotMatch(headerCluster, /aria-label=\{mode === "dark"/);
        assert.match(src, /Dark mode/);
    });

    it("signed-out theme control lives in the footer", () => {
        const footer = readFileSync(FOOTER, "utf8");
        assert.match(footer, /toggleMode/);
        assert.match(footer, /Dark mode/);
        assert.match(footer, /bg-background/);
        assert.doesNotMatch(footer, /siteChrome/);
        assert.doesNotMatch(footer, /bg-chrome/);
    });

    it("MobileTabBar forwards tourSelector as data-tour", () => {
        const src = readFileSync(MOBILE_TABBAR, "utf8");
        assert.match(src, /data-tour=\{tab\.tourSelector\}/);
    });

    it("MobileTabBar paints paper chrome, not ink siteChrome", () => {
        const src = readFileSync(MOBILE_TABBAR, "utf8");
        assert.match(src, /bg-background/);
        assert.doesNotMatch(src, /siteChrome/);
        assert.doesNotMatch(src, /bg-chrome/);
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

describe("jobs-relist JIT tour", () => {
    it("is a one-step tour using the shared RELISTED_EXPLAIN copy", () => {
        const steps = tourSteps["jobs-relist"];
        assert.ok(steps);
        assert.equal(steps.length, 1);
        assert.equal(steps[0].selector, '[data-tour="row-exception"][data-exception="relisted"]');
        assert.match(steps[0].title, /relist/i);
        assert.equal(steps[0].description, RELISTED_EXPLAIN);
    });

    it("jobs-stale and jobs-exception-both one-step tours exist", () => {
        const stale = tourSteps["jobs-stale"];
        assert.ok(stale);
        assert.equal(stale[0].selector, '[data-tour="row-exception"][data-exception="stale"]');
        assert.equal(stale[0].description, GHOST_META.likely_ghost!.explain);

        const both = tourSteps["jobs-exception-both"];
        assert.ok(both);
        assert.equal(both[0].selector, '[data-tour="row-exception"][data-exception="both"]');
        assert.match(both[0].description, /refreshed/i);
        assert.match(both[0].description, /may no longer be live/i);
    });

    it("shouldShowRelistJit: false unless main tour done, unseen, relist in DOM, and listings visible", () => {
        const cases = [
            { mainTourActive: true, hasSeenMainTour: true, hasSeenRelist: false, relistInDom: true, listingsVisible: true, expected: false },
            { mainTourActive: false, hasSeenMainTour: true, hasSeenRelist: true, relistInDom: true, listingsVisible: true, expected: false },
            { mainTourActive: false, hasSeenMainTour: true, hasSeenRelist: false, relistInDom: false, listingsVisible: true, expected: false },
            { mainTourActive: false, hasSeenMainTour: false, hasSeenRelist: false, relistInDom: true, listingsVisible: true, expected: false },
            { mainTourActive: false, hasSeenMainTour: true, hasSeenRelist: false, relistInDom: true, listingsVisible: false, expected: false },
            { mainTourActive: false, hasSeenMainTour: true, hasSeenRelist: false, relistInDom: true, listingsVisible: true, expected: true },
        ] as const;

        for (const c of cases) {
            assert.equal(
                shouldShowRelistJit(c),
                c.expected,
                `main=${c.mainTourActive} seenMain=${c.hasSeenMainTour} seenRelist=${c.hasSeenRelist} dom=${c.relistInDom} listings=${c.listingsVisible}`,
            );
        }
    });

    it("pickExceptionJit: both wins over stale and relisted", () => {
        assert.equal(
            pickExceptionJit({
                mainTourActive: false,
                hasSeenMainTour: true,
                exceptionTourActive: false,
                hasSeenBoth: false,
                hasSeenStale: false,
                hasSeenRelist: false,
                bothInDom: true,
                staleInDom: true,
                relistInDom: true,
                listingsVisible: true,
            }),
            "both",
        );
        assert.equal(
            pickExceptionJit({
                mainTourActive: false,
                hasSeenMainTour: true,
                exceptionTourActive: false,
                hasSeenBoth: true,
                hasSeenStale: false,
                hasSeenRelist: false,
                bothInDom: false,
                staleInDom: true,
                relistInDom: true,
                listingsVisible: true,
            }),
            "stale",
        );
        assert.equal(
            pickExceptionJit({
                mainTourActive: false,
                hasSeenMainTour: true,
                exceptionTourActive: false,
                hasSeenBoth: true,
                hasSeenStale: true,
                hasSeenRelist: false,
                bothInDom: false,
                staleInDom: false,
                relistInDom: true,
                listingsVisible: true,
            }),
            "relisted",
        );
        assert.equal(
            pickExceptionJit({
                mainTourActive: false,
                hasSeenMainTour: true,
                exceptionTourActive: false,
                hasSeenBoth: true,
                hasSeenStale: true,
                hasSeenRelist: false,
                bothInDom: false,
                staleInDom: false,
                relistInDom: true,
                listingsVisible: false,
            }),
            null,
        );
    });
});

describe("jobs page chrome guards", () => {
    it("uses a 20-row first fetch window mirrored in the server browse action", () => {
        const pageSrc = readFileSync(PAGE, "utf8");
        const actionsSrc = readFileSync(JOBS_ACTIONS, "utf8");
        assert.match(pageSrc, /const PAGE = 20;/);
        assert.match(actionsSrc, /const DEFAULT_BROWSE_LIMIT = 20;/);
    });

    it("FacetBar is not gated behind !showLandingMarketing", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.doesNotMatch(src, /!showLandingMarketing\s*&&\s*\(\s*\n?\s*<FacetBar/);
        assert.doesNotMatch(src, /!showLandingMarketing\s*&&\s*<FacetBar/);
    });

    it("does not render LandingUspSection on the page", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.doesNotMatch(src, /<LandingUspSection/);
    });

    it("TourTrigger suppresses the floating CTA on /jobs", () => {
        const src = readFileSync(TOUR_TRIGGER, "utf8");
        assert.match(src, /pageId\s*===\s*["']jobs["']/);
        assert.match(src, /return null/);
    });

    it("signed-out TopBar offers Sign in and Get job alerts, and only one auth system", () => {
        const src = readFileSync(TOPBAR, "utf8");
        const start = src.indexOf('authChrome === "pending"');
        assert.notStrictEqual(start, -1, "auth chrome branch not found in TopBar");
        const authBlock = src.slice(start, src.indexOf("<AuthPopover"));
        assert.match(authBlock, /topbar-signin/);
        assert.match(authBlock, /topbar-alerts-cta/);
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
            src.indexOf('authChrome === "authenticated"'),
        );
        assert.doesNotMatch(pending, /topbar-signin|topbar-alerts-cta/);
        assert.match(pending, /topbar-auth-pending/);
    });

    it("résumé prompts stay off while any jobs tour is active", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /showResumeMoment[\s\S]*!tourActive/);
    });

    it("SERP renders exactly one h1 — masthead branch or sr-only fallback, never both", () => {
        // The masthead and the sr-only fallback are the two arms of one
        // ternary (2026-08-26 front-door redesign), so at most one can ever
        // be in the DOM at a time — this is the guard against ever co-mounting
        // two heroes, kept as a structural check rather than a component-name
        // check now that the masthead is inline markup, not a component.
        const src = readFileSync(PAGE, "utf8");
        const mastheadStart = src.indexOf("{showLandingMarketing ? (");
        const fallbackH1 = src.indexOf('<h1 className="sr-only">Jobs</h1>');
        assert.notStrictEqual(mastheadStart, -1, "masthead ternary anchor moved — update this test");
        assert.notStrictEqual(fallbackH1, -1, "sr-only fallback h1 anchor moved — update this test");
        assert.ok(fallbackH1 > mastheadStart, "sr-only h1 should be the ternary's else branch");
        const h1Count = (src.match(/<h1[\s>]/g) || []).length;
        assert.equal(h1Count, 2, "expected exactly two <h1> literals — masthead branch + sr-only fallback");
    });

    it("loading splash copy uses readable status text size", () => {
        const src = readFileSync(PAGE, "utf8");
        const splash = src.slice(src.indexOf("function JobsListSplash"), src.indexOf("/* ----------------------------- results mode"));
        assert.match(splash, /Finding live roles/);
        assert.doesNotMatch(splash, /text-\[11px\]/);
    });

    it("sort segments portal into the docked TopBar filter row", () => {
        const page = readFileSync(PAGE, "utf8");
        const topbar = readFileSync(TOPBAR, "utf8");
        assert.match(topbar, /data-testid="topbar-docked-sort"/);
        assert.match(page, /topbar-docked-sort/);
        assert.match(page, /createPortal\(\s*sortEl/);
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
        assert.match(page, /createPortal\(savedSearchMountEl/);
        assert.match(page, /savedSearchMountEl\s*=\s*rankByFitEl \|\| savedSearchControl/);
        assert.match(topbar, /data-testid="topbar-docked-clear-filters"/);
        assert.match(topbar, /data-testid="topbar-docked-save-search"/);
        const dockedRow = topbar.slice(
            topbar.indexOf('data-testid="topbar-docked-field-directory"'),
            topbar.indexOf('data-testid="topbar-docked-extras"'),
        );
        const fieldIdx = dockedRow.indexOf("topbar-docked-field-directory");
        const filtersIdx = dockedRow.indexOf("topbar-docked-filters-toggle");
        const facetsIdx = dockedRow.indexOf("topbar-docked-facets");
        const clearIdx = dockedRow.indexOf("topbar-docked-clear-filters");
        const saveIdx = dockedRow.indexOf("topbar-docked-save-search");
        const chipIdx = dockedRow.indexOf("topbar-docked-chip");
        const sortIdx = dockedRow.indexOf("topbar-docked-sort");
        assert.ok(fieldIdx > -1 && filtersIdx > fieldIdx && facetsIdx > filtersIdx, "Browse by field mounts before Filters, then facets");
        assert.ok(chipIdx > facetsIdx, "Leftover filter chips mount after facet dropdowns");
        assert.ok(clearIdx > chipIdx, "Clear filters mounts at the trailing end of the chip cluster");
        assert.ok(saveIdx > clearIdx, "Save search stays after Clear, on the far-right side of the spacer");
        assert.doesNotMatch(topbar, /topbar-docked-status/, "live corpus count deferred from docked toolbar");
        assert.ok(sortIdx > saveIdx, "Sort segments mount after save search");
        const spacerIdx = dockedRow.indexOf('min-w-0 flex-1');
        assert.ok(spacerIdx > clearIdx && saveIdx > spacerIdx, "Clear stays with the filter cluster; Save search is after the flex spacer");
    });

    it("auto-starts the jobs tour only after a result card exists", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /data-tour="jobs-card"/);
        assert.match(src, /hits\.length === 0\) return/);
        assert.match(src, /\[hasSeenTour, startTour, hits\.length\]/);
        assert.match(src, /hasSeenMainTour:\s*hasSeenTour\("jobs"\)/);
    });

    it("jobs tour replay uses the shared toolbar height token", () => {
        const src = readFileSync(PAGE, "utf8");
        const replay = src.slice(
            src.indexOf("function JobsTourReplayButton"),
            src.indexOf("function JobCard"),
        );
        assert.match(replay, /toolbarControlHeight/);
        assert.doesNotMatch(replay, /h-9 w-9/);
    });

    it("mounts the masthead's headline and provenance line when showLandingMarketing", () => {
        // Was the "does not render LandingMasthead" guard for the OLD bug
        // (component authored, never mounted). The masthead is now inline
        // markup absorbed at this callsite — assert its real content mounts
        // instead of asserting a component name that no longer exists.
        const src = readFileSync(PAGE, "utf8");
        const start = src.indexOf("{showLandingMarketing ? (");
        const end = src.indexOf('<h1 className="sr-only">Jobs</h1>');
        assert.notStrictEqual(start, -1);
        assert.notStrictEqual(end, -1);
        const branch = src.slice(start, end);
        assert.match(branch, /JOBS_USP\.mastheadTitle/);
        assert.match(branch, /JOBS_USP\.searchDescription/);
        assert.match(branch, /liveCountEl/);
    });

    it("lg+ always docks search in the header", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /const headerDockActive = isLgUp;/);
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
        const src = readFileSync(PAGE, "utf8");
        const jobCard = src.slice(src.indexOf("function JobCard"), src.indexOf("function JobCardSkeleton"));
        assert.doesNotMatch(jobCard, /TRUST_CHIP/);
        assert.doesNotMatch(jobCard, /✕/);
        assert.doesNotMatch(jobCard, /⟳/);
        assert.match(jobCard, /rowExceptionMark/);
        assert.match(jobCard, /data-exception=\{exceptionMark\.kind\}/);
        assert.match(jobCard, /data-testid="row-exception"/);
    });

    it("exception JIT queries data-exception selectors and pickExceptionJit", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /pickExceptionJit/);
        assert.match(src, /listingsVisible: hits\.length > 0/);
        assert.match(src, /\[data-exception="both"\]/);
        assert.match(src, /\[data-exception="stale"\]/);
        assert.match(src, /\[data-exception="relisted"\]/);
        assert.match(src, /jobs-exception-both/);
        assert.match(src, /jobs-stale/);
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
        assert.match(src, /!showJobsToolbarRow && savedSearchControl/);
    });

    it("mounts FilterChipsRow inside the toolbar scroller", () => {
        const src = readFileSync(PAGE, "utf8");
        const toolbar = src.slice(src.indexOf('data-testid="jobs-toolbar"'));
        assert.match(toolbar, /<FilterChipsRow/);
        const beforeToolbar = src.slice(0, src.indexOf('data-testid="jobs-toolbar"'));
        assert.doesNotMatch(beforeToolbar, /<FilterChipsRow/);
    });

    it("mounts the filter toolbar before Browse by field on the landing", () => {
        const src = readFileSync(PAGE, "utf8");
        const toolbarIdx = src.indexOf('data-testid="jobs-toolbar"');
        const showcaseIdx = src.indexOf("<LandingMarketingShowcase");
        assert.ok(toolbarIdx > -1 && showcaseIdx > toolbarIdx, "jobs-toolbar precedes LandingMarketingShowcase");
    });

});
