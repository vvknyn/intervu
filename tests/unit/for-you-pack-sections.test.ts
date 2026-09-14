import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitPackSections } from "../../src/lib/jobs/for-you/pack-sections";

describe("splitPackSections", () => {
    it("routes blocks under recognized headings", () => {
        const sections = splitPackSections(
            "About the role:\n\nWe build tools.\n\nResponsibilities:\n\nShip features.\n\nRequirements:\n\n5+ years experience.",
        );
        assert.ok(sections.about.some((b) => b.text?.includes("We build")));
        assert.ok(sections.responsibilities.some((b) => b.text?.includes("Ship")));
        assert.ok(sections.requirements.some((b) => b.text?.includes("5+ years")));
    });

    it("keeps unmatched prose in About", () => {
        const sections = splitPackSections("We are a small team doing important work.");
        assert.equal(sections.about.length, 1);
        assert.equal(sections.responsibilities.length, 0);
    });

    it("does not include heading blocks in section content", () => {
        const sections = splitPackSections(
            "About the role:\n\nWe build tools.\n\nResponsibilities:\n\nShip features.\n\nRequirements:\n\n5+ years experience.",
        );
        for (const blocks of Object.values(sections)) {
            assert.ok(blocks.every((b) => b.type !== "heading"));
        }
    });
});
