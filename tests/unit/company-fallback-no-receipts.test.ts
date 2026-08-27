import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyHeader } from "../../src/components/company/CompanyHeader";
import { CompanyRolesList } from "../../src/components/company/CompanyRolesList";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * `/companies/[slug]`'s domain-less fallback (2026-08-27 receipts audit):
 * `CompanyGhostMixBand` and `CompanyFreshnessBand` used to render here
 * UNGATED, even though `/co/[slug]` locks the same data behind
 * `CompanyIntelGate` — a domain-less company has no follow key for that gate,
 * so the fix was to stop rendering the receipt, not build a gate that can't
 * exist. Both components are deleted; this locks the fallback body (what the
 * page renders once `profile.roles.length > 0`) to never reintroduce one.
 */

const PAGE = join(__dirname, "..", "..", "src", "app", "companies", "[slug]", "page.tsx");

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
    return {
        title: "Backend Engineer",
        company: "Acme",
        company_domain: null,
        location: "Remote",
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "remote",
        description: null,
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://example.com",
        source: "test",
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "clear",
        ...overrides,
    } as PublicJob;
}

test("page source no longer imports or renders the gated-receipt bands", () => {
    // The doc comment above legitimately names both components (explaining why
    // they were removed) — so the probe scopes to actual import/JSX usage, not
    // a bare substring match against the whole file including its prose.
    const src = readFileSync(PAGE, "utf8");
    assert.doesNotMatch(src, /import\s*\{[^}]*CompanyGhostMixBand/);
    assert.doesNotMatch(src, /import\s*\{[^}]*CompanyFreshnessBand/);
    assert.doesNotMatch(src, /<CompanyGhostMixBand/);
    assert.doesNotMatch(src, /<CompanyFreshnessBand/);
    assert.match(src, /<CompanyHeader/);
    assert.match(src, /<CompanyRolesList/);
});

test("fallback markup carries no company-ghost- testid, while header+roles ARE present on the same render", () => {
    // Renders exactly what the page's non-empty branch composes today
    // (CompanyHeader + CompanyRolesList, no bands in between).
    const html = renderToStaticMarkup(
        React.createElement(
            React.Fragment,
            null,
            React.createElement(CompanyHeader, { name: "Acme", totalOpenRoles: 1 }),
            React.createElement(CompanyRolesList, {
                roles: [job({ id: "1" })],
                jobsSearchUrl: "/?q=Acme",
                now: Date.now(),
            }),
        ),
    );

    // The negative claim.
    assert.doesNotMatch(html, /company-ghost-/, "no company-ghost- testid of any kind should render");

    // The probe proves it can say "yes" too, on this exact render — a probe
    // that always returns false would pass the assertion above for free.
    assert.match(html, /data-testid="company-header"/);
    assert.match(html, /data-testid="company-roles"/);
});
