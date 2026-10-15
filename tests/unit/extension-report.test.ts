import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jobFromPage, looksLikeJob, placeFromTitle, postingKey, validThrough, type PageRead } from "../../extension/src/page-reader";
import { jobCountries } from "../../src/lib/jobs/resume-location";
import { pageChecks, sameJob } from "../../extension/src/report";
import { orderForRole } from "../../src/lib/resume/order-for-role";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";

const NOW = Date.parse("2026-10-08T12:00:00Z");

const READ: PageRead = {
    url: "https://careers.example.org/jobs/registered-nurse-icu?src=board",
    title: "Registered Nurse - ICU | Example Health Careers",
    text: "Registered Nurse - ICU. Example Health, Toronto.",
    posting: {
        title: "Registered Nurse - ICU",
        datePosted: "2026-10-04",
        validThrough: "2026-11-15",
        employmentType: "FULL_TIME",
        hiringOrganization: { "@type": "Organization", name: "Example Health" },
        jobLocation: { "@type": "Place", address: { addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" } },
        baseSalary: { currency: "CAD", value: { minValue: 41, maxValue: 58, unitText: "HOUR" } },
        description: "<p>Provide care to critically ill adults.</p><ul><li>IV therapy</li></ul>",
    },
};

function hit(over: Partial<PublicJob>): PublicJob {
    return { ...jobFromPage(READ), id: "velai-1", source: "company_site", ...over };
}

describe("jobFromPage", () => {
    it("reads the role from the page's JobPosting details, leaving what it doesn't state unknown", () => {
        const job = jobFromPage(READ);
        assert.equal(job.title, "Registered Nurse - ICU");
        assert.equal(job.company, "Example Health");
        assert.equal(job.location, "Toronto, ON, CA");
        assert.equal(job.location_country, "CA");
        assert.equal(job.employment_type, "full_time");
        assert.deepEqual([job.salary_min, job.salary_max, job.salary_currency, job.salary_period], [41, 58, "CAD", "hour"]);
        assert.equal(job.posted_at, "2026-10-04");
        assert.equal(job.experience_level, "");
        assert.equal(job.ghost_badge, "unscored");
        assert.match(job.description ?? "", /critically ill adults/);
        assert.doesNotMatch(job.description ?? "", /<p>/);
        assert.equal(validThrough(READ), "2026-11-15");
    });

    it("falls back to the page title when the page publishes no job details", () => {
        const job = jobFromPage({ ...READ, posting: null, title: "Senior Accountant - Toronto, ON | Acme Careers" });
        assert.equal(job.title, "Senior Accountant");
        assert.equal(job.company, null);
        assert.equal(job.salary_min, null);
        assert.equal(job.description, READ.text);
    });
});

describe("postingKey", () => {
    it("ignores www, the query, the hash, case and a trailing slash", () => {
        assert.equal(postingKey("https://www.Careers.example.org/Jobs/123/?utm=x#apply"), "careers.example.org/jobs/123");
        assert.equal(postingKey("not a url"), null);
    });
});

describe("sameJob", () => {
    it("finds Velai's copy by its posting URL", () => {
        const copy = hit({ apply_url: "https://careers.example.org/jobs/registered-nurse-icu/", title: "RN ICU (Days)" });
        assert.equal(sameJob([hit({ apply_url: "https://other.example/x" }), copy], READ.url, jobFromPage(READ)), copy);
    });

    it("falls back to the same title at the same company", () => {
        const copy = hit({ apply_url: "https://boards.example.com/example-health/77" });
        assert.equal(sameJob([copy], READ.url, jobFromPage(READ)), copy);
    });

    it("never passes a different role or another company's role off as this one", () => {
        const page = jobFromPage(READ);
        assert.equal(sameJob([hit({ apply_url: "https://x.example/1", title: "Registered Nurse - ER" })], READ.url, page), null);
        assert.equal(sameJob([hit({ apply_url: "https://x.example/1", company: "Other Health" })], READ.url, page), null);
        assert.equal(sameJob([hit({ apply_url: "https://x.example/1" })], READ.url, { ...page, company: null }), null);
    });
});

describe("pageChecks", () => {
    it("says plainly Velai hasn't checked it and repeats only what the page states", () => {
        const labels = pageChecks(jobFromPage(READ), validThrough(READ), NOW).map((l) => l.label);
        assert.equal(labels[0], "Not on Velai yet");
        assert.ok(labels.includes("The page says it was posted Oct 4"));
        assert.ok(labels.includes("The page says apply by Nov 15"));
        assert.ok(labels.some((l) => l.startsWith("Pay ") && l.includes("41")));
    });

    it("flags an apply-by date that has passed and a page without pay", () => {
        const job = { ...jobFromPage(READ), salary_min: null, salary_max: null };
        const lines = pageChecks(job, "2026-09-30", NOW);
        assert.ok(lines.some((l) => l.label === "The page says applications closed Sep 30" && l.tone === "bad"));
        assert.ok(lines.some((l) => l.label === "The page doesn't list pay"));
    });
});

function resume(): ResumeData {
    return {
        profile: { name: "Sam Rivera", profession: "Registered Nurse", yearsOfExperience: 6, location: "Toronto", email: "", phone: "" },
        experience: [
            {
                id: "e1",
                company: "City Hospital",
                role: "Registered Nurse",
                dates: "2022 - Present",
                description: "• Mentored new graduate nurses\n• Administered IV therapy and charted in Epic\n• Ran unit fire drills",
            },
            { id: "e2", company: "Clinic", role: "Nurse", dates: "2019 - 2022", description: "• Only one line here" },
        ],
        competencies: [{ category: "Skills", skills: ["Wound care", "Epic", "Phlebotomy", "IV therapy"] }],
        education: [],
        generatedSummary: "",
    };
}

describe("orderForRole", () => {
    it("moves the lines and skills that use the job's words first, without changing a word", () => {
        const before = resume();
        const out = orderForRole(before, ["therapy", "epic", "charting"]);
        assert.equal(out.resume.experience[0].description, "- Administered IV therapy and charted in Epic\n- Mentored new graduate nurses\n- Ran unit fire drills");
        assert.deepEqual(out.movedRoles, ["Registered Nurse · City Hospital"]);
        assert.deepEqual(out.resume.competencies[0].skills, ["Epic", "IV therapy", "Wound care", "Phlebotomy"]);
        assert.deepEqual(out.leadingSkills, ["Epic", "IV therapy"]);
        // A one-line entry and the input itself stay as they were.
        assert.equal(out.resume.experience[1], before.experience[1]);
        assert.equal(before.experience[0].description, resume().experience[0].description);
    });

    it("leaves the résumé alone when the job's words don't change the order", () => {
        const out = orderForRole(resume(), ["mentored", "wound"]);
        assert.deepEqual(out.movedRoles, []);
        assert.deepEqual(out.leadingSkills, []);
        assert.equal(out.resume.experience[0].description, resume().experience[0].description);
    });
});

describe("careers pages that publish no JobPosting", () => {
    const amazonStyle: PageRead = {
        url: "https://careers.example/en/jobs/10575719/senior-cloud-tam",
        title: "Senior Cloud Technical Account Manager - Vancouver, CAN , AWS Enterprise Support - Job ID: 10575719 | Example Careers",
        heading: "Senior Cloud Technical Account Manager - Vancouver, CAN , AWS Enterprise Support",
        applyControl: true,
        posting: null,
        text: "Description\nWould you like to join...\nBASIC QUALIFICATIONS\n- 5+ years...\nJob details\nCAN, BC, Vancouver",
    };

    it("reads the place the heading names, so the country is known", () => {
        assert.equal(placeFromTitle(amazonStyle.heading!), "Vancouver, CAN");
        assert.equal(placeFromTitle("Registered Nurse | Toronto, ON"), "Toronto, ON");
        assert.equal(placeFromTitle("Data Engineer - Bangalore, IND"), "Bangalore, IND");
        assert.equal(placeFromTitle("Engineer, Web Platform - Acme"), null);
        const job = jobFromPage(amazonStyle);
        assert.equal(job.location, "Vancouver, CAN");
        assert.deepEqual(jobCountries(job), ["Canada"]);
    });

    it("counts as a job with a heading, an Apply control and a job description's words", () => {
        assert.equal(looksLikeJob(amazonStyle), true);
        assert.equal(looksLikeJob({ ...amazonStyle, applyControl: false }), false, "no Apply button");
        assert.equal(looksLikeJob({ ...amazonStyle, heading: "" }), false, "no heading");
        assert.equal(looksLikeJob({ ...amazonStyle, text: "Our blog: ten fall hikes" }), false, "not a job's words");
    });
});
