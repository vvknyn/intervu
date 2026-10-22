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

    it("a gap between roles is excluded", () => {
        // 2015-01 -> 2016-12 = 23 months, 2020-01 -> 2026-01 = 72 months: 95 months = 7 years (old span answer: 11)
        assert.equal(computeYearsOfExperience([exp("Jan 2015 - Dec 2016", "a"), exp("Jan 2020 - Present", "b")], now), 7);
    });

    it("overlap plus gap: only the merged spans are summed", () => {
        // 2010-01 -> 2013-01 (36, overlap merged) + 2018-01 -> 2026-01 (96) = 132 months = 11 (old span answer: 16)
        assert.equal(
            computeYearsOfExperience([exp("Jan 2010 - Jun 2012", "a"), exp("2011 - Jan 2013", "b"), exp("2018 - Present", "c")], now),
            11,
        );
    });

    it("back-to-back roles with a month-granular seam stay continuous", () => {
        assert.equal(computeYearsOfExperience([exp("Jan 2015 - Dec 2019", "a"), exp("Jan 2020 - Present", "b")], now), 11);
    });

    it("a single role is its own span; roles without dates are ignored", () => {
        assert.equal(computeYearsOfExperience([exp("Jan 2021 - Jan 2024", "a"), exp("", "b")], now), 3);
        assert.equal(computeYearsOfExperience([exp("", "a"), exp("n/a", "b")], now), null);
    });
});
