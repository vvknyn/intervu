import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "../../src/components/jobs/JobCard";
import { readPlaceRestriction } from "../../src/lib/jobs/place-restriction";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * A hover tooltip in a /jobs row may only add information the row does not
 * already show. The row-meta div (block-level, fills the text column) used to
 * carry "Company · Place", so the tooltip fired over empty space far from the
 * text it repeated (2026-10-26).
 */

const NOW = Date.parse("2026-10-26T12:00:00Z");

const BASE = {
    id: "row-1",
    title: "Data Analyst",
    company: "AlphaSense",
    company_domain: "alphasense.example",
    location: null,
    location_city: null,
    location_state: null,
    location_country: null,
    work_type: "onsite",
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

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (job: PublicJob) => renderToStaticMarkup(React.createElement(JobCard, { job, active: false, opened: false, onClick: () => {}, now: NOW }));
const visibleText = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
// Every title in the row except an icon button's own action label (the Save/Saved bookmark), which names what the button does.
const titles = (html: string) =>
    [...html.matchAll(/<(\w+)([^>]*?)\stitle="([^"]*)"/g)].filter((m) => m[1] !== "button").map((m) => decode(m[3]));

const CASES: Record<string, PublicJob> = {
    plain: { ...BASE, id: "plain", location: "Toronto, Canada", location_city: "Toronto", location_country: "Canada" },
    rawDiffers: { ...BASE, id: "raw", location: "Greater Toronto Area (hybrid, 3 days)", location_city: "Toronto", location_country: "Canada" },
    scoped: {
        ...BASE,
        id: "scoped",
        work_type: "remote",
        location: "Remote",
        place_restriction: readPlaceRestriction("Remote in Canada."),
    },
};

for (const [name, job] of Object.entries(CASES)) {
    test(`${name}: every title in the row adds text the row does not show`, () => {
        const html = render(job);
        const text = visibleText(html);
        assert.ok(text.includes("AlphaSense"), "company is visible");
        for (const t of titles(html)) assert.ok(!text.includes(t), `title "${t}" repeats visible text`);
    });
}

test("the titles that remain are the ones that add something", () => {
    assert.deepEqual(titles(render(CASES.plain)), []);
    assert.deepEqual(titles(render(CASES.rawDiffers)), ["Greater Toronto Area (hybrid, 3 days)"]);
    assert.deepEqual(titles(render(CASES.scoped)), ["The posting says: “Remote in Canada.”"]);
});
