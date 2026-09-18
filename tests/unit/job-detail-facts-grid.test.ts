import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobDetail } from "../../src/components/jobs/JobDetail";
import { salaryText } from "../../src/lib/jobs/presentation";
import { alsoInLabel } from "../../src/components/jobs/job-detail-facts";
import type { PublicJob } from "../../src/lib/jobs/types";

/** Local to this test file only — `presentation.ts`'s own `escapeRegExp`
 *  isn't exported and that file is out of scope for this change; this is
 *  test infra, not a second copy of any domain formatting rule. */
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Component-level proof for the "facts only, no new claims" rule behind the
 * detail-pane cards restyle (2026-09-17): every cell in the facts grid, and
 * the Pay card, must be present or absent based on whether the underlying
 * PublicJob field actually carries a value — never rendered as an empty
 * label, a dash, or a fabricated default. Same renderToStaticMarkup pattern
 * as the sibling `job-detail-location-clamp.test.ts`.
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

function renderDetail(job: PublicJob, variants: PublicJob[] = []): string {
    return renderToStaticMarkup(
        React.createElement(JobDetail, {
            job,
            variants,
            now: Date.now(),
            source: "direct",
            onOpenPosting: noop,
            onGoAfter: noop,
            pursuit: undefined,
            goingAfter: false,
            signedIn: true,
        }),
    );
}

test("no salary on the record omits the Pay card entirely", () => {
    const html = renderDetail(baseJob({ salary_min: null, salary_max: null }));
    assert.doesNotMatch(html, /data-tour="jobs-pay"/, "the Pay card must not mount when the job carries no salary");
    assert.doesNotMatch(html, /disclosed in the posting/, "no pay-disclosed copy without a salary value");
});

test("a disclosed salary renders the Pay card with that exact figure", () => {
    const job = baseJob({ salary_min: 120000, salary_max: 150000, salary_currency: "USD", salary_period: "year" });
    const html = renderDetail(job);
    assert.match(html, /data-tour="jobs-pay"/, "the Pay card must mount once the job discloses a salary");
    assert.match(html, /disclosed in the posting/);
    const figure = salaryText(job);
    assert.ok(figure, "salaryText must derive a figure from the fixture's salary fields");
    assert.match(html, new RegExp(escapeRegExp(figure!)), "the rendered Pay card must carry the exact salaryText figure, not just its wrapper");
});

test("a one-bound salary (min only) still renders its exact figure", () => {
    const job = baseJob({ salary_min: 90000, salary_max: null, salary_currency: "USD", salary_period: "year" });
    const html = renderDetail(job);
    assert.match(html, /data-tour="jobs-pay"/);
    const figure = salaryText(job);
    assert.ok(figure);
    assert.match(html, new RegExp(escapeRegExp(figure!)), "a min-only salary must still render its formatted figure, not a range placeholder");
});

test("a work_type of \"unknown\" omits its facts-grid cell, leaving other cells intact", () => {
    // work_type/employment_type/experience_level are plain `string` on
    // PublicJob (never null) — "unknown" is their absence sentinel, which
    // `prettyEnum` (presentation.ts) maps to "" same as null/undefined.
    // location intentionally avoids the word "Remote" so this assertion
    // can't pass by accident on the (unrelated) location cell's own text.
    const html = renderDetail(baseJob({ work_type: "unknown", location: "San Francisco, CA", location_city: "San Francisco", location_state: "CA" }));
    assert.doesNotMatch(html, /Remote\b/, "no work-type label should render when work_type is \"unknown\"");
    // Sibling cells (employment type, experience level) still come from
    // their own fields and must be unaffected by work_type being absent.
    assert.match(html, /Full time/i, "employment type must still render independently");
});

test("employment_type AND experience_level both \"unknown\" together omit that whole grid cell", () => {
    const html = renderDetail(baseJob({ employment_type: "unknown", experience_level: "unknown" }));
    assert.doesNotMatch(html, /Full time/i);
    assert.doesNotMatch(html, /Mid\b/i);
});

test("other cluster variants in a different place render an \"also in\" line under location", () => {
    const job = baseJob({ location: "Seattle, WA", location_city: "Seattle", location_state: "WA" });
    const variants = [
        baseJob({ id: "job-2", location: "Redmond, WA", location_city: "Redmond", location_state: "WA" }),
        baseJob({ id: "job-3", location: "Dublin, Ireland", location_city: "Dublin", location_state: null, location_country: "IE" }),
    ];
    const html = renderDetail(job, variants);
    const label = alsoInLabel(job, variants);
    assert.ok(label, "fixture must produce a non-empty also-in label");
    assert.match(html, new RegExp(`also in ${escapeRegExp(label!)}`), "the also-in line must reuse alsoInLabel's own text verbatim");
});

test("no cluster variants omit the \"also in\" line entirely", () => {
    const html = renderDetail(baseJob({ location: "Seattle, WA", location_city: "Seattle", location_state: "WA" }), []);
    assert.doesNotMatch(html, /also in/i, "no variants means nothing to say — no also-in line should render");
});

test("report_count of 0 omits the reported-by line", () => {
    const html = renderDetail(baseJob({ report_count: 0 }));
    assert.doesNotMatch(html, /reported/i);
});

test("a report_count of 3 renders the exact reported-by wording", () => {
    const html = renderDetail(baseJob({ report_count: 3 }));
    assert.match(html, /reported 3 users/);
});
