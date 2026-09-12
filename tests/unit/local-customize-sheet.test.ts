import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobDetail, JobDetailActionBar } from "../../src/components/jobs/JobDetail";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";

const PANEL = join(__dirname, "..", "..", "src", "components", "jobs", "LocalCustomizePanel.tsx");
const DETAIL = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetail.tsx");
const DOCUMENT = join(__dirname, "..", "..", "src", "components", "jobs", "JobDetailDocument.tsx");

const memory = new Map<string, string>();
const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
        memory.set(key, String(value));
    },
    removeItem: (key: string) => {
        memory.delete(key);
    },
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
        return memory.size;
    },
};

before(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    memory.set("velai.localAi.enabled", "1");
});

after(() => {
    memory.clear();
});

function baseJob(overrides: Partial<PublicJob> = {}): PublicJob {
    return {
        id: "job-1",
        title: "Product Manager",
        company: "Acme Corp",
        company_domain: "acme.example",
        location: "Remote",
        location_city: null,
        location_state: null,
        location_country: "US",
        work_type: "remote",
        description: "Own the product roadmap and drive cross-functional planning.",
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: ["roadmap", "product"],
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

const resume: ResumeData = {
    profile: {
        name: "Jane Doe",
        profession: "Product Manager",
        yearsOfExperience: 6,
        location: "Toronto, Ontario",
        email: "jane@example.com",
        phone: "",
    },
    experience: [
        {
            id: "exp-1",
            company: "Acme Corp",
            role: "Senior Product Manager",
            dates: "2021 - Present",
            description: "Led product planning for B2B SaaS platform",
        },
    ],
    competencies: [{ category: "Skills", skills: ["Product planning", "Roadmap"] }],
    education: [],
    generatedSummary: "Product manager with 6 years driving product planning.",
};

const noop = () => {};

describe("Customize sheet contract", () => {
    it("opens a bottom Sheet with its own scroll and sticky footer, not an inline expand", () => {
        const src = readFileSync(PANEL, "utf8");
        assert.match(src, /side="bottom"/);
        assert.match(src, /overflow-y-auto/);
        assert.match(src, /min-h-0 flex-1/);
        assert.match(src, /confirmToast/);
        assert.match(src, /Enable on-device AI/);
        assert.match(src, /Use a rules draft/);
        assert.match(src, /Résumé updated for Rank on this device/);
        assert.doesNotMatch(src, /basis-full/);
        assert.doesNotMatch(
            src,
            /open && \(\s*<div[^>]*local-customize-panel/,
            "draft must not expand inline under the trigger",
        );
    });

    it("JobDetail action row keeps the compact trigger; document mobile bar gets it too", () => {
        const detail = readFileSync(DETAIL, "utf8");
        const doc = readFileSync(DOCUMENT, "utf8");
        const page = readFileSync(join(__dirname, "..", "..", "src", "app", "jobs", "page.tsx"), "utf8");
        const publicDetail = readFileSync(
            join(__dirname, "..", "..", "src", "components", "jobs", "PublicJobDetail.tsx"),
            "utf8",
        );
        assert.match(detail, /<LocalCustomizePanel/);
        assert.match(detail, /compactTrigger/);
        assert.match(doc, /resume=\{resume\}/);
        assert.match(doc, /onAcceptLocalTailor=\{onAcceptLocalTailor\}/);
        const pageBar = page.match(/<JobDetailActionBar[\s\S]*?\/>/)?.[0] ?? "";
        const publicBar = publicDetail.match(/<JobDetailActionBar[\s\S]*?\/>/)?.[0] ?? "";
        assert.ok(pageBar, "SERP must still mount JobDetailActionBar");
        assert.ok(publicBar, "PublicJobDetail panel must still mount JobDetailActionBar");
        assert.doesNotMatch(
            pageBar,
            /resume=/,
            "SERP JobDetailActionBar must not take resume (would duplicate the action-row trigger)",
        );
        assert.doesNotMatch(
            publicBar,
            /resume=/,
            "PublicJobDetail panel action bar must not take resume (JobDetail already has the trigger)",
        );
    });

    it("SSR JobDetail shows the trigger and does not emit the draft inline", () => {
        const html = renderToStaticMarkup(
            React.createElement(JobDetail, {
                job: baseJob(),
                now: Date.now(),
                source: "direct",
                onOpenPosting: noop,
                onGoAfter: noop,
                pursuit: undefined,
                goingAfter: false,
                signedIn: true,
                resume,
            }),
        );
        assert.match(html, /data-testid="local-customize-open"/);
        assert.match(html, /Customize for this job/);
        assert.doesNotMatch(html, /data-testid="local-customize-panel"/);
        assert.doesNotMatch(html, /basis-full/);
        assert.doesNotMatch(html, /Tailoring on-device/);
    });

    it("SSR action bar uses the compact Customize label", () => {
        const html = renderToStaticMarkup(
            React.createElement(JobDetailActionBar, {
                job: baseJob(),
                onOpenPosting: noop,
                onGoAfter: noop,
                pursuit: undefined,
                goingAfter: false,
                resume,
            }),
        );
        assert.match(html, /data-testid="local-customize-open"/);
        assert.match(html, />Customize</);
        assert.doesNotMatch(html, /Customize for this job</);
        assert.doesNotMatch(html, /data-testid="local-customize-panel"/);
    });
});
