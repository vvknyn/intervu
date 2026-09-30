import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobDetail, JobDetailActionBar } from "../../src/components/jobs/JobDetail";
import { LocalCustomizePanel } from "../../src/components/jobs/LocalCustomizePanel";
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

describe("Customize dialog contract", () => {
    it("opens a Dialog portaled above the pane with scroll body and sticky footer", () => {
        const src = readFileSync(PANEL, "utf8");
        assert.match(src, /<Dialog/);
        assert.doesNotMatch(src, /side="bottom"/);
        assert.match(src, /DialogContent/);
        // The primitive's tier keeps the dialog above its scrim; a z-[70] override put it under (2026-09-30).
        assert.doesNotMatch(src, /<DialogContent[^>]*\bz-/);
        assert.match(src, /<DialogBody[^>]*data-testid="local-customize-panel"/);
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

    it("trigger is an outline Button, not a ghost text link", () => {
        const src = readFileSync(PANEL, "utf8");
        assert.match(src, /variant="outline"/);
        assert.match(src, /data-testid="local-customize-open"/);
        assert.match(src, /<Button/);
    });

    it("JobDetail action row wraps on narrow viewports with Apply · Customize · Bookmark order", () => {
        const detail = readFileSync(DETAIL, "utf8");
        const actionRow = detail.match(/\/\* Action row \*\/[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
        assert.match(actionRow, /flex flex-wrap items-center gap-2/);
        const applyIdx = actionRow.indexOf("Apply");
        const customizeIdx = actionRow.indexOf("<LocalCustomizePanel");
        const bookmarkIdx = actionRow.indexOf("<RowBookmarkButton");
        assert.ok(applyIdx >= 0 && customizeIdx > applyIdx, "Customize follows Apply");
        assert.ok(bookmarkIdx > customizeIdx, "Bookmark follows Customize");
    });

    it("accordion sections: summary expanded by default, experience blocks collapsed", () => {
        const src = readFileSync(PANEL, "utf8");
        assert.match(src, /defaultValue=\{\["summary"\]\}/);
        assert.match(src, /local-customize-section-summary/);
        assert.match(src, /local-customize-section-\$\{/);
    });

    it("copy uses zip markdown; PDF exports from ResumeData", () => {
        const src = readFileSync(PANEL, "utf8");
        assert.match(src, /resumeDataToZipMarkdown/);
        assert.match(src, /exportZipResumePdfFromData/);
        assert.doesNotMatch(src, /resumeDataToMarkdown/);
        assert.doesNotMatch(src, /renderResumePdf/);
        assert.doesNotMatch(src, /exportZipResumePdf\(/);
        assert.match(src, /data-testid="local-customize-pdf"/);
    });

    it("JobDetail action row and the job page's apply card keep the trigger; no phone action bar takes it", () => {
        const detail = readFileSync(DETAIL, "utf8");
        const doc = readFileSync(DOCUMENT, "utf8");
        const page = readFileSync(join(__dirname, "..", "..", "src", "app", "jobs", "JobsContent.tsx"), "utf8");
        const publicDetail = readFileSync(
            join(__dirname, "..", "..", "src", "components", "jobs", "PublicJobDetail.tsx"),
            "utf8",
        );
        assert.match(detail, /<LocalCustomizePanel/);
        assert.match(doc, /<LocalCustomizePanel[\s\S]*?resume=\{resume\}/);
        assert.match(doc, /onAccept=\{onAcceptLocalTailor\}/);
        const pageBar = page.match(/<JobDetailActionBar[\s\S]*?\/>/)?.[0] ?? "";
        const publicBar = publicDetail.match(/<JobDetailActionBar[\s\S]*?\/>/)?.[0] ?? "";
        const docBar = doc.match(/<JobDetailActionBar[\s\S]*?\/>/)?.[0] ?? "";
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
        // Apply and Save fill a phone's bar; a Customize or Upload button beside them ran off a 390px screen (2026-09-30).
        assert.ok(docBar, "the job page must still mount JobDetailActionBar");
        assert.doesNotMatch(docBar, /resume=|onUploadResume=/, "the job page's phone bar carries Apply and Save only");
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
                signedIn: true,
                resume,
            }),
        );
        assert.match(html, /data-testid="local-customize-open"/);
        assert.match(html, /Customize/);
        assert.match(html, / for this job/);
        assert.doesNotMatch(html, /data-testid="local-customize-panel"/);
        assert.doesNotMatch(html, /basis-full/);
        assert.doesNotMatch(html, /Tailoring on-device/);
    });

    it("SSR action bar has Apply and Save, no Customize trigger", () => {
        const html = renderToStaticMarkup(
            React.createElement(JobDetailActionBar, {
                job: baseJob(),
                onOpenPosting: noop,
                onGoAfter: noop,
                pursuit: undefined,
            }),
        );
        assert.match(html, /Apply on employer site/);
        assert.doesNotMatch(html, /data-testid="local-customize-open"/);
        assert.doesNotMatch(html, /job-detail-upload-to-customize/);
    });

    it("SSR compact trigger uses the short Customize label", () => {
        const html = renderToStaticMarkup(
            React.createElement(LocalCustomizePanel, { job: baseJob(), resume, compactTrigger: true, signedIn: true }),
        );
        assert.match(html, /data-testid="local-customize-open"/);
        // f714e2d0 renamed the trigger "Customize" → "Customize résumé" (copy states what a résumé unlocks).
        assert.match(html, />Customize résumé<\/button>/);
        assert.doesNotMatch(html, /hidden sm:inline.*for this job/);
        assert.doesNotMatch(html, /data-testid="local-customize-panel"/);
    });
});
