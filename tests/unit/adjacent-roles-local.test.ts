import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { suggestAdjacentRolesLocal } from "../../src/lib/jobs/adjacent-roles";

describe("suggestAdjacentRolesLocal", () => {
    it("is deterministic for same inputs", () => {
        const a = suggestAdjacentRolesLocal("Senior Backend Engineer", ["Python", "AWS"]);
        const b = suggestAdjacentRolesLocal("Senior Backend Engineer", ["Python", "AWS"]);
        assert.deepEqual(a, b);
    });

    it("returns adjacent titles for engineering profession", () => {
        const titles = suggestAdjacentRolesLocal("Software Engineer", ["React"]);
        assert.ok(titles.length > 0);
        assert.ok(titles.some((t) => /engineer|developer/i.test(t)));
    });

    it("respects max cap", () => {
        const titles = suggestAdjacentRolesLocal("Full Stack Developer", ["React", "Node", "AWS"], 2);
        assert.equal(titles.length, 2);
    });
});
