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

    it("includes Product Manager for CS/TAM headline blobs", () => {
        const titles = suggestAdjacentRolesLocal(
            "Customer Success Operations Manager | Technical Account Management",
        );
        assert.ok(titles.some((t) => /product manager/i.test(t)), titles.join(", "));
        assert.ok(
            titles.some((t) => /technical account manager|customer success manager/i.test(t)),
            titles.join(", "),
        );
    });

    it("still includes Product Manager for client-facing PM titles", () => {
        const titles = suggestAdjacentRolesLocal("Client-facing Product Manager");
        assert.ok(titles.some((t) => /product manager/i.test(t)), titles.join(", "));
    });

    it("accepts multiple title strings", () => {
        const single = suggestAdjacentRolesLocal("Client-facing Product Manager");
        const multi = suggestAdjacentRolesLocal([
            "Customer Success Operations Manager",
            "Client-facing Product Manager",
        ]);
        assert.ok(multi.some((t) => /product manager/i.test(t)));
        assert.deepEqual(single, suggestAdjacentRolesLocal(["Client-facing Product Manager"]));
    });

    it("does not drown CS/TAM matches with generic Engineering Manager", () => {
        const titles = suggestAdjacentRolesLocal("Customer Success Operations Manager");
        assert.ok(!titles.some((t) => /engineering manager/i.test(t)), titles.join(", "));
        assert.ok(titles.some((t) => /customer success manager/i.test(t)), titles.join(", "));
    });
});
