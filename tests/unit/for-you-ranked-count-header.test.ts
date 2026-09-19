import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ForYouHome, type ForYouHomeProps } from "../../src/components/jobs/for-you/ForYouHome";
import type { PublicJob } from "../../src/lib/jobs/types";

// ForYouHome calls useRouter() internally, which throws outside an
// AppRouterContext.Provider — supply a stub instance so the pure
// list-header text below can render without a real Next.js app router.
const mockRouter: AppRouterInstance = {
    back: () => {},
    forward: () => {},
    refresh: () => {},
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    bfcacheId: "test-router",
};

function renderWithRouter(element: React.ReactElement): string {
    return renderToStaticMarkup(
        React.createElement(AppRouterContext.Provider, { value: mockRouter }, element),
    );
}

/**
 * Decision 3: the list header shows the REAL ranked count (never a fixed
 * "20"/deck-length stand-in) plus "By fit". Asserted against the actual
 * `visiblePacks.length` for two different list sizes so the header can't
 * pass by having a lucky hardcoded number.
 */

function job(id: string): PublicJob {
    return {
        id,
        title: "Software Engineer",
        company: "Acme Corp",
        company_domain: "acme.example",
        location: "Remote",
        location_city: null,
        location_state: null,
        location_country: "US",
        work_type: "remote",
        description: "A short description.",
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://acme.example/apply",
        source: "acme.example",
        posted_at: new Date().toISOString(),
        first_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        vacancy_status: "open",
        ghost_badge: "unscored",
    };
}

const noop = () => {};

function baseProps(visiblePacks: PublicJob[]): ForYouHomeProps {
    return {
        visiblePacks,
        activeIndex: 0,
        onActiveIndexChange: noop,
        activeJob: visiblePacks[0] ?? null,
        onSkip: noop,
        matchScores: new Map(),
        matchAsOfDate: null,
        resume: null,
        nowMs: Date.now(),
        lastUpdated: null,
        fitResolving: false,
        loading: false,
        fitActive: true,
        hydratedJobs: new Map(),
        onActivePackChange: noop,
        onOpenPosting: noop,
        onHomeViewChange: noop,
        showSearchCta: true,
        signedIn: true,
        onRequestSignIn: noop,
        pursuitsByJobId: new Map(),
        onGoAfter: noop,
        goingAfterId: null,
        reportJobEnabled: false,
        reportDialogOpen: false,
        onReportDialogOpenChange: noop,
        onAcceptLocalTailor: noop,
    };
}

function resultLineText(html: string): string {
    const m = html.match(/data-testid="for-you-result-line"[^>]*>([\s\S]*?)<\/span>/);
    assert.ok(m, "expected a data-testid=\"for-you-result-line\" element");
    return m![1];
}

test("3 ranked roles: header reads exactly '3 ranked · By fit'", () => {
    const html = renderWithRouter(React.createElement(ForYouHome, baseProps([job("a"), job("b"), job("c")])));
    assert.equal(resultLineText(html), "3 ranked · By fit");
});

test("a different length (7) tracks the real count too — not a hardcoded number from the first case", () => {
    const packs = ["a", "b", "c", "d", "e", "f", "g"].map(job);
    const html = renderWithRouter(React.createElement(ForYouHome, baseProps(packs)));
    assert.equal(resultLineText(html), "7 ranked · By fit");
});
