import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeYearsOfExperience } from "@/lib/resume/years-of-experience";
import type { ResumeExperience } from "@/types/resume";

const exp = (dates: string, id: string): ResumeExperience => ({ id, company: "Acme", role: "Engineer", dates, description: "" });
const now = new Date(2026, 0, 1);

describe("computeYearsOfExperience never double counts overlapping or open-ended roles", () => {
    it("overlapping roles plus an open-ended present role are not double counted", () => {
        const years = computeYearsOfExperience(
            [exp("Jan 2018 - Dec 2021", "a"), exp("Jan 2020 - Present", "b"), exp("2019 - 2020", "c")],
            now,
        );
        assert.equal(years, 8); // 2018-01 -> 2026-01, one continuous stretch
    });

    it("contained role adds nothing", () => {
        assert.equal(computeYearsOfExperience([exp("Jan 2016 - Present", "a"), exp("2018 - 2019", "b")], now), 10);
    });
});
