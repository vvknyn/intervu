import { test } from "node:test";
import assert from "node:assert/strict";
import { applyQueryUnderstanding } from "../../src/lib/jobs/query-understanding";
import { understoodLine, diffUnderstood } from "../../src/lib/jobs/understood";
import fixtures from "./fixtures/nl-search-deterministic.json";

interface Expect {
    salaryMin: number | null;
    postedBucket: string | null;
    yearsExperience: string | null;
    employment_type: string | null;
    work_type: string | null;
    residualQ: string;
    mentions: string[];
}

/** What the deterministic stage reads off a sentence, in the fixture's own terms. */
async function read(q: string): Promise<Expect> {
    const o = await applyQueryUnderstanding({ q });
    return {
        salaryMin: o.salaryMin ?? null,
        postedBucket: o.postedBucket ?? null,
        yearsExperience: o.yearsExperience ?? null,
        employment_type: o.facets?.employment_type?.[0] ?? null,
        work_type: o.facets?.work_type?.[0] ?? null,
        residualQ: o.q ?? "",
        mentions: o.unmatchedQueryMentions ?? [],
    };
}

for (const [i, c] of fixtures.cases.entries()) {
    const gap = "knownGap" in c ? (c as { knownGap: string }).knownGap : undefined;
    test(`fixture ${i + 1}: ${c.q}`, { todo: gap }, async () => assert.deepEqual(await read(c.q), c.expect));
}

// Class rule: every parser also on sentences that are not in the fixture file.
const extras: [string, Partial<Expect>][] = [
    ["ruby developer $120,000+ last 3 days 4 yrs part-time no agencies", {
        salaryMin: 120000, postedBucket: "3d", yearsExperience: "3-5", employment_type: "part_time",
        residualQ: "ruby developer", mentions: ["no agencies"],
    }],
    ["remote nurse practitioner over 95k usd posted today", {
        salaryMin: 95000, postedBucket: "1d", work_type: "remote", residualQ: "nurse practitioner",
    }],
    ["Contractor data engineer, 10+ years, past 2 weeks, without java", {
        postedBucket: "30d", yearsExperience: "6-10", employment_type: "contract", residualQ: "data engineer", mentions: ["without java"],
    }],
    ["barista full-time this week 30,000", {
        salaryMin: 30000, postedBucket: "7d", employment_type: "full_time", residualQ: "barista",
    }],
    ["data analyst not remote", { residualQ: "data analyst", mentions: ["not remote"] }],
    ["no hybrid roles", { residualQ: "", mentions: ["no hybrid roles"] }],
    ["java developer 2 days in the office", { work_type: "hybrid", residualQ: "java developer" }],
    ["java developer 5 days onsite", { work_type: "onsite", residualQ: "java developer" }],
    ["internship designer", { employment_type: "internship", residualQ: "designer" }],
];
for (const [q, want] of extras) {
    test(`extra sentence: ${q}`, async () => {
        const got = await read(q);
        assert.deepEqual(got, { salaryMin: null, postedBucket: null, yearsExperience: null, employment_type: null, work_type: null, mentions: [], ...want });
    });
}

test("a typed 150k reaches the chips: understood echoes salaryMin as 'deterministic' and the line names it", async () => {
    const raw = { q: "product manager over 150k CAD" };
    const understood = diffUnderstood(raw, await applyQueryUnderstanding(raw), "deterministic");
    assert.deepEqual(understood, { params: { salaryMin: 150000 }, residualQ: "product manager", source: "deterministic" });
    assert.equal(understoodLine(understood!.residualQ, [{ key: "salary", label: "$150k+" }], (e) => e.label), "Searched “product manager” · $150k+");
});
