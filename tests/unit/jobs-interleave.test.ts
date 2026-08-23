import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { interleaveByCompany } from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";

let seq = 0;
function job(overrides: Partial<PublicJob> = {}): PublicJob {
    seq += 1;
    return {
        id: `job-${seq}`,
        title: "Senior Product Designer",
        company: "Acme Inc.",
        company_domain: "acme.com",
        location: null,
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "remote",
        description: null,
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://example.com/apply",
        source: "greenhouse",
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "unscored",
        ...overrides,
    };
}

/** Longest run of any single company's id-prefix in `jobs`, for assertions. */
function longestRun(jobs: PublicJob[]): number {
    let longest = 0;
    let current = 0;
    let last: string | null = null;
    for (const j of jobs) {
        const key = (j.company ?? "").toLowerCase();
        current = key === last ? current + 1 : 1;
        longest = Math.max(longest, current);
        last = key;
    }
    return longest;
}

describe("interleaveByCompany", () => {
    // A DIFFERENT shape than the live-prod instance that motivated this fix
    // (10x Extendicare, 7x, 3x): two companies of very unequal size, neither
    // of them Extendicare/Greystar/"Company 1", proving the fix is class-wide
    // rather than tuned to the one observed case.
    it("breaks up a long run from one company by borrowing from a smaller one, dropping nothing", () => {
        const bigCo = Array.from({ length: 6 }, (_, i) => job({ company: "Northwind Traders", title: `Role ${i}` }));
        const smallCo = [job({ company: "Initech", title: "Analyst" }), job({ company: "Initech", title: "Clerk" })];
        const input = [...bigCo, ...smallCo];

        const out = interleaveByCompany(input);

        assert.ok(longestRun(out) <= 2, `expected no run over 2, got ${longestRun(out)}`);
        // No drops: same multiset of ids, just reordered.
        assert.deepEqual(
            [...out.map((j) => j.id)].sort(),
            [...input.map((j) => j.id)].sort(),
        );
    });

    it("preserves each company's own relative order among its hits (stable within company)", () => {
        const input = [
            job({ company: "Northwind Traders", title: "First" }),
            job({ company: "Northwind Traders", title: "Second" }),
            job({ company: "Northwind Traders", title: "Third" }),
            job({ company: "Initech", title: "Only" }),
        ];
        const out = interleaveByCompany(input);
        const northwindTitles = out.filter((j) => j.company === "Northwind Traders").map((j) => j.title);
        assert.deepEqual(northwindTitles, ["First", "Second", "Third"]);
    });

    it("leaves an already-compliant, alternating sequence byte-for-byte unchanged", () => {
        const input = [
            job({ company: "Northwind Traders", title: "A1" }),
            job({ company: "Initech", title: "B1" }),
            job({ company: "Northwind Traders", title: "A2" }),
            job({ company: "Initech", title: "B2" }),
            job({ company: "Northwind Traders", title: "A3" }),
            job({ company: "Initech", title: "B3" }),
        ];
        const out = interleaveByCompany(input);
        assert.deepEqual(out.map((j) => j.id), input.map((j) => j.id));
    });

    it("continues the run rather than dropping a hit when every other company is exhausted", () => {
        const input = [
            job({ company: "Northwind Traders" }),
            job({ company: "Northwind Traders" }),
            job({ company: "Northwind Traders" }),
            job({ company: "Northwind Traders" }),
        ];
        const out = interleaveByCompany(input);
        assert.equal(out.length, 4);
        assert.deepEqual(out.map((j) => j.id), input.map((j) => j.id));
    });

    it("respects a custom maxRun", () => {
        // Equal supply on both sides so a run of 1 is actually achievable —
        // unlike the "continues the run" case above, nothing here forces an
        // unavoidable overrun.
        const input = [
            job({ company: "Northwind Traders" }),
            job({ company: "Northwind Traders" }),
            job({ company: "Initech" }),
            job({ company: "Initech" }),
        ];
        const out = interleaveByCompany(input, 1);
        assert.ok(longestRun(out) <= 1, `expected no run over 1, got ${longestRun(out)}`);
        assert.deepEqual(
            [...out.map((j) => j.id)].sort(),
            [...input.map((j) => j.id)].sort(),
        );
    });

    it("does not crash or drop hits when company is null", () => {
        const input = [job({ company: null, title: "X" }), job({ company: null, title: "Y" }), job({ company: "Initech" })];
        const out = interleaveByCompany(input);
        assert.equal(out.length, 3);
        assert.deepEqual(
            [...out.map((j) => j.id)].sort(),
            [...input.map((j) => j.id)].sort(),
        );
    });
});
