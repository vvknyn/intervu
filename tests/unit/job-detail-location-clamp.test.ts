import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobDetail } from "../../src/components/jobs/JobDetail";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * Component-level proof for the location-dump clamp (2026-08-20). Root
 * cause: a scraped aggregator posting can carry `location` as a
 * semicolon-joined dump ("San Diego CA Renewable Group; Remote - AZ;
 * Remote - AR; Remote - CA; Remote - DE; Remote - IN"), and `locationText`
 * (presentation.ts) passes non-JSON prose through verbatim — the identity
 * header rendered all of it inline, six lines of text on the card. Fix:
 * `clampLocationSegments` (presentation.ts) is a pure split-and-clamp
 * decision consumed by JobDetail's identity header, same progressive-
 * disclosure idiom as the description clamp above it in this file's
 * sibling, `job-detail-description-collapse.test.ts`.
 *
 * This renders the REAL `JobDetail` component via `renderToStaticMarkup`
 * (same pattern as the sibling file) and asserts on the emitted markup — a
 * static render can't click, so this only proves the COLLAPSED state: 2
 * segments visible, the "+N more locations" toggle present, and the other
 * segments' text absent from the markup.
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
        ...overrides,
    };
}

const noop = () => {};

function renderDetail(job: PublicJob): string {
    return renderToStaticMarkup(
        React.createElement(JobDetail, {
            job,
            now: Date.now(),
            onOpenPosting: noop,
            onGoAfter: noop,
            pursuit: undefined,
            goingAfter: false,
            signedIn: true,
        }),
    );
}

test("a 6-segment location dump renders only the first 2 segments plus a '+4 more locations' toggle", () => {
    const html = renderDetail(
        baseJob({
            location:
                "San Diego CA Renewable Group; Remote - AZ; Remote - AR; Remote - CA; Remote - DE; Remote - IN",
        }),
    );
    assert.match(html, /San Diego CA Renewable Group/, "first visible segment must render");
    assert.match(html, /Remote - AZ/, "second visible segment must render");
    assert.match(html, /\+ 4 more locations/, 'the collapsed toggle must read "+ 4 more locations"');
    assert.doesNotMatch(html, /Remote - AR/, "3rd hidden segment must not be in the markup before expanding");
    assert.doesNotMatch(html, /Remote - CA/, "4th hidden segment must not be in the markup before expanding");
    assert.doesNotMatch(html, /Remote - DE/, "5th hidden segment must not be in the markup before expanding");
    assert.doesNotMatch(html, /Remote - IN/, "6th hidden segment must not be in the markup before expanding");
});

test("a plain location with no semicolons renders unchanged, no toggle", () => {
    const html = renderDetail(baseJob({ location: "Remote", work_type: "remote" }));
    assert.doesNotMatch(html, /more locations/, "a single-segment location must not show the clamp toggle");
});

test("exactly 3 segments render in full, unsplit, with no toggle (clamp threshold is > 3, not >=)", () => {
    // At <=3 segments JobDetail renders the raw `locationText` string as-is
    // (no per-segment spans) — presentation-only, zero behavior change.
    const html = renderDetail(baseJob({ location: "A; B; C", work_type: "onsite" }));
    assert.match(html, /A; B; C/, "all 3 segments should render as the original joined string");
    assert.doesNotMatch(html, /more locations/, "exactly 3 segments must not trigger the clamp toggle");
});
