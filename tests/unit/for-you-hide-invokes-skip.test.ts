import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobDetail } from "../../src/components/jobs/JobDetail";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * Decision 5: Skip becomes a quiet "Hide" item in JobDetail's shared
 * overflow (dots) menu, wired to the EXISTING `onSkip`/`handleSkip` — not a
 * second skip mechanism. Radix's `DropdownMenuItem.onSelect` only fires
 * through real pointer/keyboard interaction, which this repo's suite can't
 * simulate (no jsdom/RTL here) — so this combines what an SSR render CAN
 * prove (the menu mounts only when a real handler is supplied, and unmounts
 * when it isn't) with a source assertion for the one line that must never
 * drift: the item's `onSelect` is the same `onSkip` prop that was passed in,
 * not a local re-implementation.
 */

const JOB_DETAIL_SRC = readFileSync(
    join(__dirname, "../../src/components/jobs/JobDetail.tsx"),
    "utf8",
);

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

function renderDetail(onSkip?: () => void): string {
    return renderToStaticMarkup(
        React.createElement(JobDetail, {
            job: baseJob(),
            now: Date.now(),
            source: "serp",
            onOpenPosting: noop,
            onGoAfter: noop,
            pursuit: undefined,
            signedIn: true,
            onSkip,
        }),
    );
}

test("the overflow-menu trigger mounts once a real onSkip handler is supplied", () => {
    // Radix's DropdownMenuContent only mounts its items once opened
    // client-side, so a closed-state SSR render never shows the "Hide"
    // item itself (data-state="closed" on the trigger below) — that's
    // covered by the source assertion. What SSR CAN prove is that the
    // trigger only exists when a real onSkip was passed in.
    const html = renderDetail(() => {});
    assert.match(html, /aria-label="More actions"/);
});

test("no onSkip handler: the overflow-menu trigger is absent entirely, not rendered inert", () => {
    const html = renderDetail(undefined);
    assert.doesNotMatch(html, /aria-label="More actions"/);
});

test("the Hide item's onSelect is wired to the onSkip prop itself, not a second skip path", () => {
    const hideItemBlock = JOB_DETAIL_SRC.match(/<DropdownMenuItem data-testid="job-detail-hide"[^>]*>/)?.[0] ?? "";
    assert.match(hideItemBlock, /onSelect=\{onSkip\}/);
});
