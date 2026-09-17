import { test } from "node:test";
import assert from "node:assert/strict";
import { getSectionOrder } from "../../src/types/resume";

const engineerProfile = { profession: "Software Engineer", yearsOfExperience: 5 };

test("a legacy saved order missing 'projects' gets it merged back in canonical position", () => {
    const order = getSectionOrder({
        sectionOrder: ["summary", "skills", "experience", "education"],
        profile: engineerProfile,
    });
    assert.deepEqual(order, ["summary", "skills", "experience", "projects", "education"]);
});

test("a legacy saved order missing a DIFFERENT section ('skills') also gets it merged back — class-wide, not just projects", () => {
    const order = getSectionOrder({
        sectionOrder: ["summary", "experience", "projects", "education"],
        profile: engineerProfile,
    });
    assert.deepEqual(order, ["summary", "skills", "experience", "projects", "education"]);
});

test("a full custom order naming every section is preserved verbatim", () => {
    const custom = ["education", "projects", "summary", "skills", "experience"] as const;
    const order = getSectionOrder({ sectionOrder: [...custom], profile: engineerProfile });
    assert.deepEqual(order, custom);
});
