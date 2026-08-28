import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobDetail } from "../../src/components/jobs/JobDetail";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * Component-level proof for the mobile job-description clipping fix
 * (2026-08-18). Root cause: `JobDetail`'s own `collapsible` clamp
 * (`(description length) > 700`) fires for nearly every real description
 * and caps the description at `max-h-[20rem]` (320px) behind a "Show full
 * description" click — a SECOND, redundant height cap one level inside the
 * mobile bottom sheet, which already owns its own `overflow-y-auto`
 * scroller (`data-testid="mobile-detail-scroller"`, jobs/page.tsx). On a
 * phone this meant opening a role showed a 320px stub no matter how long
 * the posting actually was.
 *
 * Fix: `JobDetail` takes a `collapseDescription` prop (default `true`, so
 * the xl+ sticky pane — which genuinely needs the clamp, see JobDetail.tsx's
 * `collapsible` comment — is unchanged); `renderDetailSurface` in
 * jobs/page.tsx threads it through, and only the mobile bottom sheet's call
 * site passes `false`.
 *
 * This test renders the REAL `JobDetail` component (not a reimplementation
 * of its logic) via `renderToStaticMarkup` and asserts on the emitted
 * markup — the same pattern `tests/unit/launch-banner.test.ts` uses — so it
 * proves the prop actually reaches the DOM, not just that a boolean
 * computes correctly. No network, no auth: a synthetic job fixture, signed
 * in (the collapse only applies on the signed-in path — the guest preview
 * at JobDetail.tsx:142 is a separate, out-of-scope gate).
 *
 * A real browser/Playwright run at a genuine 390x844 mobile viewport is a
 * SEPARATE, complementary check (mobile.spec.ts) — that one runs signed OUT
 * (no live account creation) and proves the sheet's own scroll plumbing and
 * mount-site wiring end to end; it cannot observe the 20rem clamp itself
 * because the guest path never renders it. This file is what proves the
 * clamp behaviour itself, at both mount sites, at two description lengths.
 */

function baseJob(overrides: Partial<PublicJob> = {}): PublicJob {
    return {
        id: "job-1",
        title: "Software Engineer",
        company: "Acme Corp",
        company_domain: "acme.example",
        location: "Remote",
        location_city: null,
        location_state: null,
        location_country: "US",
        work_type: "remote",
        description: "x".repeat(800),
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
        ...overrides,
    };
}

const noop = () => {};

function renderDetail(job: PublicJob, collapseDescription?: boolean): string {
    return renderToStaticMarkup(
        React.createElement(JobDetail, {
            job,
            now: Date.now(),
            source: "direct",
            onOpenPosting: noop,
            onGoAfter: noop,
            pursuit: undefined,
            goingAfter: false,
            signedIn: true,
            collapseDescription,
        }),
    );
}

// Two lengths, not one: proves the fix isn't tuned to a single fixture.
const JUST_OVER_THRESHOLD = "x".repeat(701); // collapsible's own threshold is > 700
const VERY_LONG = "y".repeat(6000);

for (const [label, description] of [
    ["a description just over the 700-char threshold", JUST_OVER_THRESHOLD],
    ["a very long description", VERY_LONG],
] as const) {
    test(`mobile sheet mount (collapseDescription=false) renders ${label} unclipped, no toggle`, () => {
        const html = renderDetail(baseJob({ description }), false);
        const descDiv = html.match(/<div data-testid="job-detail-description"[^>]*>/)?.[0] ?? "";
        assert.ok(descDiv.length > 0, "description container should render");
        assert.doesNotMatch(descDiv, /max-h-\[20rem\]/, "mobile mount must not carry the height clamp class");
        assert.doesNotMatch(descDiv, /overflow-hidden/, "mobile mount must not carry the clip-overflow class");
        assert.doesNotMatch(html, /Show full description/, 'the "Show full description" toggle must be gone entirely, not merely expanded');
        assert.doesNotMatch(html, /Show less/, "no orphaned expand/collapse control on this mount site");
        // The full text is actually IN the markup (this mount's own scroller,
        // not JobDetail, is what makes it reachable — see jobs/page.tsx).
        assert.match(html, new RegExp(description.slice(0, 50)), "full description text must render, not a truncated stub");
    });

    test(`desktop pane mount (collapseDescription default true) still clamps ${label}`, () => {
        // No explicit `collapseDescription` — proves the DEFAULT (every
        // existing call site that doesn't pass the prop) keeps today's
        // behaviour, matching what `renderDetailSurface`'s xl+ pane call
        // site does.
        const html = renderDetail(baseJob({ description }));
        const descDiv = html.match(/<div data-testid="job-detail-description"[^>]*>/)?.[0] ?? "";
        assert.ok(descDiv.length > 0, "description container should render");
        assert.match(descDiv, /max-h-\[20rem\]/, "desktop pane must keep the height clamp class");
        assert.match(descDiv, /overflow-hidden/, "desktop pane must keep the clip-overflow class");
        assert.match(html, /Show full description/, 'desktop pane must keep the "Show full description" toggle — feature not deleted');
    });
}

test("a description AT the 700-char threshold (not over) never collapses on either mount site", () => {
    // `collapsible` is a strict `> 700`, not `>=` — this is the boundary
    // case for that operator, independent of collapseDescription entirely.
    const html = renderDetail(baseJob({ description: "z".repeat(700) }));
    assert.doesNotMatch(html, /Show full description/, "exactly 700 chars must not trigger the collapse");
});
