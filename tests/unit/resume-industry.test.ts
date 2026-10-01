import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { phraseIndustry, resumeIndustry, type IndustryId } from "../../src/lib/jobs/resume-industry";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";
import type { ResumeData } from "../../src/types/resume";

function mk(profession: string, roles: string[] = [], degree = "", categories: string[] = []): ResumeData {
    return {
        profile: { name: "", profession, yearsOfExperience: 4, location: "Toronto, ON, Canada", email: "", phone: "" },
        experience: roles.map((role, i) => ({ id: `e${i}`, company: "", role, dates: "2022 - Present", description: "" })),
        competencies: categories.map((category) => ({ category, skills: [] })),
        education: degree ? [{ id: "ed", degree, institution: "", year: "" } as never] : [],
        generatedSummary: "",
    };
}

const golden = (name: string): ResumeData =>
    structureResumeText(readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), "utf8").replace(/'/g, "’")) as ResumeData;

describe("the industry of a résumé's profession", () => {
    const cases: Array<[string, ResumeData, IndustryId]> = [
        ["a health science graduate", mk("Health Science Graduate", ["Research Assistant", "Clinic Volunteer"], "BSc Health Sciences", ["Research", "Clinical"]), "health"],
        ["a registered nurse", mk("Registered Nurse", ["Registered Nurse, ICU"], "BScN"), "health"],
        ["a clinical research coordinator", mk("Clinical Research Coordinator", ["Clinical Research Coordinator"]), "health"],
        ["a physiotherapist", mk("Physiotherapist", ["Physiotherapist"]), "health"],
        ["a medical lab technologist", mk("Medical Laboratory Technologist", ["Laboratory Assistant"]), "health"],
        ["a public health analyst", mk("Public Health Analyst", ["Epidemiologist"], "MPH"), "health"],
        ["a pharmacist", mk("Pharmacist", ["Hospital Pharmacist"], "PharmD"), "health"],
        ["a nurse informaticist (health, not tech)", mk("Nurse Informaticist", ["Clinical Informatics Nurse"]), "health"],
        ["a software engineer at a hospital (tech, not health)", mk("Software Engineer", ["Software Engineer, Healthcare"]), "tech"],
        ["a product manager", mk("Senior Product Manager", ["Senior Product Manager"]), "tech"],
        ["a data analyst", mk("Data Analyst", ["Data Analyst"], "BSc Statistics"), "tech"],
        ["a teacher", mk("Elementary School Teacher", ["Grade 3 Teacher"], "B.Ed"), "education"],
        ["an accountant", mk("CPA", ["Senior Accountant"]), "finance"],
        ["an electrician", mk("Licensed Electrician", ["Journeyman Electrician"]), "trades"],
        ["a truck driver", mk("CDL-A Truck Driver", ["Long Haul Driver"]), "logistics"],
        ["a barista", mk("Barista", ["Shift Supervisor"]), "service"],
        ["an account executive", mk("Account Executive", ["Sales Development Representative"]), "business"],
        ["an administrative assistant", mk("Administrative Assistant", ["Receptionist"]), "office"],
        ["a mechanical engineer (not software)", mk("Mechanical Engineer", ["Mechanical Engineer"]), "general"],
        ["an empty résumé", mk(""), "general"],
    ];
    for (const [name, resume, want] of cases) {
        it(`${name} is ${want}`, () => assert.equal(resumeIndustry(resume), want));
    }

    it("reads the golden résumés as tech and go-to-market", () => {
        assert.equal(resumeIndustry(golden("vivek-pm-resume")), "tech");
        assert.equal(resumeIndustry(golden("sample-resume")), "tech");
        assert.equal(resumeIndustry(golden("vivek-okta-resume")), "business");
    });

    it("keeps short words whole: an intern is not an RN, a principal engineer is not a school principal", () => {
        assert.notEqual(phraseIndustry("Marketing Intern"), "health");
        assert.equal(phraseIndustry("Principal Software Engineer"), "tech");
        assert.equal(phraseIndustry("Vice Principal"), "education");
        assert.equal(phraseIndustry("Pharmaceutical Sales Representative"), "business");
    });
});
