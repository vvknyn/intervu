import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";
import { normalizeParsedResume } from "../../src/lib/resume/normalize-parsed-resume";
import { cleanRoleTitle, isRoleTitlePhrase, roleTitleFromLine } from "../../src/lib/resume/title-text";
import { buildMatchQuery } from "../../src/lib/jobs/resume-match";

/** Each separator style a résumé uses between title, company, place and dates. */
const DIRTY_LINES: Array<[string, string]> = [
    ["Product Manager — Shopify, Ottawa, ON — June 2019 – February 2022", "Product Manager"],
    ["Staff Software Engineer – Stripe, Remote – Jan 2018 – Present", "Staff Software Engineer"],
    ["Marketing Manager - HubSpot, Dublin, Ireland - 03/2020 - 05/2023", "Marketing Manager"],
    ["Customer Success Manager | Zendesk | Austin, TX | Sept 2016 – Dec 2019", "Customer Success Manager"],
    ["Operations Lead at Flexport, San Francisco, CA, 2015 - 2018", "Operations Lead"],
    ["Data Scientist\tAirbnb\tSan Francisco, CA\tMay 2014 – Aug 2014", "Data Scientist"],
    ["Airbnb — Senior Data Scientist — 2019 – Present", "Senior Data Scientist"],
    ["Recruiter, Google, Mountain View, CA (2012 – 2016)", "Recruiter"],
];

describe("roleTitleFromLine / cleanRoleTitle", () => {
    for (const [line, title] of DIRTY_LINES) {
        it(`keeps only the title: ${title}`, () => {
            assert.equal(roleTitleFromLine(line), title);
            assert.equal(cleanRoleTitle(line), title);
        });
    }

    it("leaves an already-clean multi-title headline untouched", () => {
        assert.equal(cleanRoleTitle("Product Manager | Data Analyst"), "Product Manager | Data Analyst");
        assert.equal(cleanRoleTitle("Director, Product"), "Director, Product");
    });
});

describe("isRoleTitlePhrase", () => {
    it("rejects phrases carrying dates, company or place tails", () => {
        for (const [line] of DIRTY_LINES) assert.equal(isRoleTitlePhrase(line), false, line);
        assert.equal(isRoleTitlePhrase("Data Analyst at Acme"), false);
        assert.equal(isRoleTitlePhrase("Data Analyst, Toronto, ON"), false);
    });
    it("accepts titles and skills", () => {
        for (const ok of ["Senior Data Analyst", "Director, Product", "A/B testing", "Node.js"]) {
            assert.equal(isRoleTitlePhrase(ok), true, ok);
        }
    });
});

describe("structureResumeText headline", () => {
    const TEXT = [
        "Marcus Okafor",
        "Austin, TX · marcus.okafor@example.com · +1 512 555 0110",
        "",
        "Summary",
        "Product leader with a decade in B2B SaaS.",
        "",
        "Experience",
        "Senior Product Manager | Zendesk | Austin, TX | Sept 2016 – Present",
        "Owned the billing roadmap.",
        "",
        "Skills",
        "Roadmapping, SQL, Figma",
    ].join("\n");

    it("never takes a dated experience line as the headline", () => {
        const out = structureResumeText(TEXT);
        assert.equal(out.profile.profession, "Senior Product Manager");
        assert.doesNotMatch(out.experience[0].company, /[—–|]\s*$/);
    });

    it("keeps a real headline above the first section", () => {
        const out = structureResumeText(["Lena Fischer", "Senior UX Designer", "Berlin, Germany", "", "Experience", "Designer at Zalando — 2018 – Present"].join("\n"));
        assert.equal(out.profile.profession, "Senior UX Designer");
    });
});

describe("normalize + query chokepoint", () => {
    it("cleans a dirty model-supplied profession and role", () => {
        const dirty = "Product Manager — Shopify, Ottawa, ON — June 2019 – February 2022";
        const out = normalizeParsedResume({
            profile: { profession: dirty },
            experience: [{ role: dirty, company: "Shopify", dates: "June 2019 – February 2022", description: "" }],
        } as never);
        assert.equal(out.parsed.profile.profession, "Product Manager");
        assert.equal(out.parsed.experience[0].role, "Product Manager");
    });

    it("never lets a dated or company-bearing phrase into the query, even from a stored profile", () => {
        for (const [dirty, title] of DIRTY_LINES) {
            const q = buildMatchQuery({
                profile: { name: "X", profession: dirty, yearsOfExperience: 5, location: "", email: "", phone: "", linkedin: "" },
                experience: [{ id: "e1", role: dirty, company: "", dates: "", description: "" }],
                competencies: [{ category: "Skills", skills: ["SQL"] }],
                education: [],
                generatedSummary: "",
            } as never);
            assert.doesNotMatch(q.q, /\b(19|20)\d{2}\b|—|–|Present/, q.q);
            assert.ok(q.phrases.every(isRoleTitlePhrase), `${title}: ${q.q}`);
        }
    });
});
