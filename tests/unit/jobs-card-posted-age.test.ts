import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "../../src/components/jobs/JobCard";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * Guards against the icon-fact row's deleted posted-age fallback
 * (`!locationKnown && factChips.length === 0 && age`) reappearing. That
 * branch asserted "Posted {age}" as a fact even though `age` is often a
 * `first_seen_at` date (`derivePostedTs` falls back to it for the 18% of
 * jobs with a null/unusable `posted_at` — meilisearch.ts's own docblock),
 * and it fired only when the meta-column age (`data-testid="posted-age"`)
 * had ALREADY rendered — so removing it loses no information, only the
 * duplicate and the false "Posted" claim.
 */

const NOW = Date.parse("2026-08-29T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

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
        first_seen_at: daysAgo(6),
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "clear",
        ghost_checked_at: daysAgo(1),
        ...overrides,
    };
}

function renderCard(j: PublicJob): string {
    return renderToStaticMarkup(
        React.createElement(JobCard, {
            job: j,
            active: false,
            opened: false,
            onClick: () => {},
            now: NOW,
        }),
    );
}

test("unknown location, no fact chips, known age: renders the age exactly once and never as 'Posted <age>'", () => {
    const html = renderCard(job({ id: "unknown-1" }));
    assert.equal((html.match(/data-testid="posted-age"/g) ?? []).length, 1);
    assert.equal((html.match(/6d ago/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Posted/);
});

test("known location and a fact chip present, known age: age still renders exactly once (class-wide, not just the empty-state case)", () => {
    const html = renderCard(
        job({
            id: "known-1",
            location_city: "Austin",
            location_state: "TX",
            location_country: "United States",
            work_type: "onsite",
            salary_min: 120_000,
            salary_max: 150_000,
            salary_currency: "USD",
            salary_period: "year",
        }),
    );
    assert.equal((html.match(/data-testid="posted-age"/g) ?? []).length, 1);
    assert.equal((html.match(/6d ago/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Posted/);
});

test("null age (no usable posted_at or first_seen_at): the age slot renders nothing, not a fallback string", () => {
    const html = renderCard(job({ id: "no-age-1", first_seen_at: null }));
    assert.doesNotMatch(html, /data-testid="posted-age"/);
    assert.doesNotMatch(html, /Posted/);
});
