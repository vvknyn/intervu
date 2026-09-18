import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "../../src/components/jobs/JobCard";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * Guards against the selected row's title carrying `hover:underline` — some
 * browsers freeze `:hover` on the element under the pointer when a click
 * re-renders the row (no real pointer movement follows), so the SELECTED
 * row's title stayed permanently underlined. Fix: the active/selected row's
 * title never carries the hover-underline utility at all; every other row
 * keeps it.
 */

const NOW = Date.parse("2026-08-29T12:00:00Z");

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
    return {
        title: "Backend Engineer",
        company: "Acme",
        company_domain: "acme.example",
        location: null,
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "unknown",
        description: null,
        employment_type: "unknown",
        experience_level: "unknown",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://example.com",
        source: "test",
        posted_at: null,
        first_seen_at: new Date(NOW - 6 * 86_400_000).toISOString(),
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "clear",
        ghost_checked_at: new Date(NOW - 86_400_000).toISOString(),
        ...overrides,
    };
}

function renderCard(j: PublicJob, active: boolean): string {
    return renderToStaticMarkup(
        React.createElement(JobCard, { job: j, active, opened: false, onClick: () => {}, now: NOW }),
    );
}

function titleClass(html: string): string {
    const m = html.match(/data-testid="job-title"[^>]*class="([^"]*)"/);
    assert.ok(m, "expected a data-testid=\"job-title\" element with a class attribute");
    return m![1];
}

test("selected row (active=true): title has no hover:underline class", () => {
    const html = renderCard(job({ id: "active-1" }), true);
    assert.doesNotMatch(titleClass(html), /hover:underline/);
});

test("unselected row (active=false): title keeps the hover:underline class — class-wide fix, not a removal", () => {
    const html = renderCard(job({ id: "inactive-1" }), false);
    assert.match(titleClass(html), /hover:underline/);
});
