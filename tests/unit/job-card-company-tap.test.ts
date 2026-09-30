import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "../../src/components/jobs/JobCard";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * On a phone the row's company name was a button filling the middle of the
 * row, so a tap there opened the company page instead of the job
 * (2026-09-30). Below lg it is plain text now; the button shows from lg up.
 */

const NOW = Date.parse("2026-09-30T12:00:00Z");

const JOB = {
    id: "row-1",
    title: "Data Analyst",
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
    first_seen_at: new Date(NOW - 86_400_000).toISOString(),
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "clear",
    ghost_checked_at: null,
} as PublicJob;

function render(onCompany?: (job: PublicJob) => void): string {
    return renderToStaticMarkup(React.createElement(JobCard, { job: JOB, active: false, opened: false, onClick: () => {}, onCompany, now: NOW }));
}

test("with a company link: plain text below lg, the button from lg up", () => {
    const html = render(() => {});
    assert.match(html, /<span class="lg:hidden">Acme<\/span>/);
    const button = html.match(/<button type="button" data-testid="job-row-company" class="([^"]*)">Acme<\/button>/);
    assert.ok(button, "expected the company button");
    assert.match(button![1], /(^| )hidden( |$)/);
    assert.match(button![1], /(^| )lg:inline( |$)/);
});

test("without a company link: the name is plain text at every width", () => {
    const html = render();
    assert.match(html, /<span>Acme<\/span>/);
    assert.doesNotMatch(html, />Acme<\/button>/);
});
