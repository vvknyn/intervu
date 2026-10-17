import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { leadTitleForm, PACK_TITLE_PHRASES_MAX, withLeadTitle } from "../../src/lib/jobs/resume-match";
import { familiesNamedBy } from "../../src/lib/match/duty-signals";
import { resolveCandidateSignals } from "../../src/lib/jobs/candidate-signals";
import { packFilters } from "../../src/lib/jobs/for-you/pack-filters";
import { parseQuotedOrPhrases } from "../../src/lib/jobs/fit-phrases";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";
import { matchBand, scoreJobAgainstResume } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";

// 2026-10-17, from the outside analysis Vivek sent: a title phrase finds only its own words, so a pack for "Product
// Manager" never retrieved a "Digital Product Lead", and the one it met elsewhere read as no kind of role.
describe("a line of work's lead title", () => {
    it("is '<line> Lead' for a title '<line> Manager' that names a line of work we know", () => {
        assert.equal(leadTitleForm("Product Manager"), "Product Lead");
        assert.equal(leadTitleForm("Customer Success Manager"), "Customer Success Lead");
        assert.equal(leadTitleForm("Technical Account Manager"), "Technical Account Lead");
        assert.equal(leadTitleForm("Marketing Manager"), "Marketing Lead");
    });

    it("is none for a rank or generic word in the line, another kind of title, or a title no role family names", () => {
        for (const title of ["Senior Product Manager", "General Manager", "Product Owner", "Registered Nurse", "Store Manager", "Case Manager", ""]) {
            assert.equal(leadTitleForm(title), null, title);
        }
    });

    it("a senior pack adds the first one to its title phrases when there is room, once", () => {
        assert.equal(
            withLeadTitle('"Product Manager" OR "Technical Product Manager" OR "Product Owner"'),
            '"Product Manager" OR "Technical Product Manager" OR "Product Owner" OR "Product Lead"',
        );
        assert.equal(withLeadTitle("Product Manager"), '"Product Manager" OR "Product Lead"');
        const full = '"Product Manager" OR "Product Owner" OR "Program Manager" OR "Business Analyst"';
        assert.equal(parseQuotedOrPhrases(full)!.length, PACK_TITLE_PHRASES_MAX);
        assert.equal(withLeadTitle(full), full, "no room: the résumé's own titles keep their places");
        assert.equal(withLeadTitle('"Product Manager" OR "product lead"'), '"Product Manager" OR "product lead"');
        assert.equal(withLeadTitle('"Registered Nurse" OR "Nurse"'), '"Registered Nurse" OR "Nurse"');
    });

    it("is read as the same line of work as its manager title, and a title that opens with Lead is read as written", () => {
        assert.deepEqual(familiesNamedBy(["Digital Product Lead"]), familiesNamedBy(["Digital Product Manager"]));
        assert.ok(familiesNamedBy(["Product Lead, Payments"]).includes("product"));
        assert.ok(familiesNamedBy(["Customer Success Lead"]).includes("customer_success"));
        assert.deepEqual(familiesNamedBy(["Lead Generation Specialist"]), []);
        // A lead in sales is a prospect: "Sales Lead Gen" is not read as "Sales Manager".
        assert.deepEqual(familiesNamedBy(["Sales Lead Gen Representative"]), []);
    });
});

describe("a senior PM's pack", () => {
    const resume = structureResumeText(readFileSync("tests/fixtures/vivek-pm-resume.txt", "utf8").replace(/'/g, "’")) as ResumeData;
    const signals = resolveCandidateSignals(resume, { configured: true, search: { remoteOnly: true }, answers: {} } as never);

    it("asks for Product Lead beside its own titles", () => {
        const phrases = parseQuotedOrPhrases(packFilters(resume, signals).q ?? "")!;
        assert.ok(phrases.includes("Product Lead"), phrases.join(" | "));
        assert.ok(phrases.includes("Product Manager"));
    });

    it("reads a Product Lead role as its own line of work, as Strong as the same role titled Product Manager", () => {
        const job = (title: string): PublicJob => ({
            id: title, title, company: "Maple Relay", company_domain: null, location: "Toronto, ON", location_city: "Toronto", location_state: "Ontario",
            location_country: "Canada", work_type: "remote", description: null, employment_type: "full_time", experience_level: "senior",
            salary_min: null, salary_max: null, salary_currency: null, salary_period: null, visa_sponsorship: null, tags: [], apply_url: "https://example.com",
            source: "test", posted_at: new Date().toISOString(), first_seen_at: null, updated_at: null, vacancy_status: "open", ghost_badge: "unscored",
        });
        const lead = scoreJobAgainstResume(resume, job("Senior Product Lead"), signals)!;
        const manager = scoreJobAgainstResume(resume, job("Senior Product Manager"), signals)!;
        assert.equal(matchBand(lead.total), "strong");
        assert.equal(matchBand(lead.total), matchBand(manager.total));
        assert.notEqual(lead.role, "unverified");
    });

    it("a mid-level résumé's pack does not ask for the lead title: a role titled Lead reads senior", () => {
        const junior = {
            profile: { name: "Pat", profession: "Product Manager", yearsOfExperience: 3, location: "Toronto, Ontario, Canada" },
            experience: [{ role: "Product Manager", company: "Acme", dates: "2023 - Present", description: "Owned the roadmap for a B2B product." }],
            competencies: [{ category: "Product", skills: ["Roadmapping", "SQL"] }],
            generatedSummary: "Product manager with three years in B2B SaaS.",
        } as unknown as ResumeData;
        const juniorSignals = resolveCandidateSignals(junior);
        const filters = packFilters(junior, juniorSignals);
        assert.ok(!(filters.facets.experience_level ?? []).includes("senior"));
        assert.ok(!(filters.q ?? "").includes("Product Lead"), filters.q ?? "");
    });
});
