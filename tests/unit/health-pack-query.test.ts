/**
 * What a health résumé's pack searches for. Only nursing had a role family,
 * so every other health profession searched its own title and whatever the
 * tech-and-sales adjacency table added (2026-09-30 audit: a health science
 * graduate searched "Health Science Graduate", "Clinic Volunteer" and a
 * duty-inferred "Registered Nurse"; a public health analyst, "Business Analyst").
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMatchQuery } from "../../src/lib/jobs/resume-match";
import type { ResumeData } from "../../src/types/resume";

function mk(profession: string, roles: Array<[string, string]>, categories: Array<[string, string[]]> = []): ResumeData {
    return {
        profile: { name: "", profession, yearsOfExperience: 5, location: "Toronto, ON, Canada", email: "", phone: "" },
        experience: roles.map(([role, description], i) => ({ id: `e${i}`, company: "", role, dates: "2022 - Present", description })),
        competencies: categories.map(([category, skills]) => ({ category, skills })),
        education: [],
        generatedSummary: "",
    };
}

const searched = (resume: ResumeData) => buildMatchQuery(resume, 2026).phrases.map((p) => p.toLowerCase());

describe("a health résumé's pack searches its own profession", () => {
    it("a health science graduate who did patient intake is not searched as a Registered Nurse", () => {
        const grad = mk(
            "Health Science Graduate",
            [
                ["Research Assistant", "Collected patient data for a cardiology study; maintained the REDCap database."],
                ["Clinic Volunteer", "Supported patient intake and triage; charting."],
            ],
            [["Clinical", ["Patient intake", "Vital signs"]]],
        );
        const phrases = searched(grad);
        assert.ok(!phrases.some((p) => /nurse/.test(p)), phrases.join(", "));
        assert.ok(!phrases.includes("health science graduate"), "a headline that names no job");
        assert.ok(!phrases.includes("clinic volunteer"), "a volunteer role is not a job title");
        assert.ok(phrases.includes("clinical research coordinator"), phrases.join(", "));
    });

    it("a physiotherapist also searches the US title, Physical Therapist", () => {
        assert.deepEqual(searched(mk("Physiotherapist", [["Physiotherapist", "Assess and treat musculoskeletal injuries."]])), ["physiotherapist", "physical therapist"]);
    });

    it("a medical lab technologist searches the other names of the job", () => {
        const phrases = searched(mk("Medical Laboratory Technologist", [["Medical Laboratory Technologist", "Hematology and microbiology assays."]]));
        assert.ok(phrases.includes("medical technologist") && phrases.includes("clinical laboratory scientist"), phrases.join(", "));
    });

    it("a public health analyst is not searched as a Business Analyst", () => {
        const phrases = searched(mk("Public Health Analyst", [["Epidemiologist", "Disease surveillance and outbreak reporting."]]));
        assert.ok(!phrases.includes("business analyst"), phrases.join(", "));
        assert.ok(phrases.includes("epidemiologist"), phrases.join(", "));
    });

    it("a nurse manager is not searched as an Engineering Manager", () => {
        const phrases = searched(mk("Nurse Manager", [["Nurse Manager", "Lead a 40-bed medical unit."]]));
        assert.ok(!phrases.some((p) => /engineer/.test(p)), phrases.join(", "));
    });

    it("a clinical coordinator whose duties are bedside care still searches nurse roles", () => {
        const phrases = searched(mk("Clinical Coordinator", [["Clinical Coordinator", "Coordinated patient care. Performed triage and medication reconciliation at bedside."]]));
        assert.ok(phrases.some((p) => /nurse/.test(p)), phrases.join(", "));
    });

    it("a growth marketer who ran free trials is not searched as a clinical research coordinator", () => {
        const phrases = searched(mk("Growth Marketing Manager", [["Growth Marketing Manager", "Ran free trial and paid trials funnels; consent banners."]]));
        assert.ok(!phrases.some((p) => /clinical/.test(p)), phrases.join(", "));
    });
});
