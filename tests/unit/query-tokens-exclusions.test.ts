import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExclusionTokens } from "../../src/lib/jobs/query-tokens/exclusions";
import { applyQueryUnderstanding } from "../../src/lib/jobs/query-understanding";

const cases: [string, string, string[]][] = [
    ["fintech product manager, no crypto", "fintech product manager", ["no crypto"]],
    ["product marketing manager, not sales", "product marketing manager", ["not sales"]],
    ["data engineer without sql", "data engineer", ["without sql"]],
    ["designer excluding agencies", "designer", ["excluding agencies"]],
    ["Analyst NOT finance or banking, remote", "Analyst, remote", ["not finance or banking"]],
    ["scrum master / agile coach, french not required", "scrum master / agile coach", ["french not required"]],
];
for (const [q, residualQ, mentions] of cases) {
    test(`exclusion: ${q}`, () => assert.deepEqual(parseExclusionTokens(q), { residualQ, mentions }));
}

test("not a negation: no-code, nothing, node, know, quoted, bare trailing 'not'", () => {
    for (const q of ["no-code developer", "nothing but nodejs", "know your customer analyst", '"no crypto" analyst', "analyst not"]) {
        assert.deepEqual(parseExclusionTokens(q), { residualQ: q, mentions: [] });
    }
});

test("through applyQueryUnderstanding: consumed from q, reported, existing mentions kept", async () => {
    const out = await applyQueryUnderstanding({ q: "fintech product manager, no crypto", unmatchedQueryMentions: ["x"] });
    assert.equal(out.q, "fintech product manager");
    assert.deepEqual(out.unmatchedQueryMentions, ["x", "no crypto"]);
    assert.equal(out.facets, undefined);
});
