/**
 * Meilisearch synonyms are DIRECTIONAL declarations, not equivalence
 * classes: `swe -> ["software engineer"]` alone would leave a search for
 * "software engineer" unable to match a posting titled "SWE". Before this
 * fix, `JOBS_SYNONYMS` hand-declared only SOME reverse hops (swe/sre/k8s/ml)
 * and left ux/qa/hr/devops one-way, producing real recall gaps: a search
 * for "user experience" did not match "UX Designer".
 *
 * `deriveSynonyms` fixes the class, not the instance: every declared term
 * in `JOBS_SYNONYM_SOURCE` gets both directions unless explicitly marked
 * `oneWay`. These tests pin that class-wide behavior — including on a
 * synthetic abbreviation that isn't in the real table, proving the fix
 * generalizes rather than re-deriving the four instances that motivated it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveSynonyms, JOBS_SYNONYMS } from "../../src/lib/jobs/meilisearch";

test("JOBS_SYNONYMS: previously one-way abbreviations now have reverse hops", () => {
    assert.deepEqual(JOBS_SYNONYMS.ux, ["user experience"]);
    assert.deepEqual(JOBS_SYNONYMS["user experience"], ["ux"]);

    assert.deepEqual(JOBS_SYNONYMS.qa, ["quality assurance"]);
    assert.deepEqual(JOBS_SYNONYMS["quality assurance"], ["qa"]);

    assert.deepEqual(JOBS_SYNONYMS.hr, ["human resources"]);
    assert.deepEqual(JOBS_SYNONYMS["human resources"], ["hr"]);

    assert.deepEqual(JOBS_SYNONYMS.devops, ["dev ops"]);
    assert.deepEqual(JOBS_SYNONYMS["dev ops"], ["devops"]);
});

test("JOBS_SYNONYMS: pm stays one-way — no reverse hop from either expansion", () => {
    assert.deepEqual(JOBS_SYNONYMS.pm, ["product manager", "project manager"]);
    // A reverse would let a "product manager" search return project-manager
    // jobs (and vice versa) via the shared `pm` hop — the opt-out this table
    // exists to preserve.
    assert.equal(JOBS_SYNONYMS["product manager"], undefined);
    assert.equal(JOBS_SYNONYMS["project manager"], undefined);
});

test("JOBS_SYNONYMS: pre-existing bidirectional pairs are unaffected", () => {
    assert.deepEqual(JOBS_SYNONYMS.swe, ["software engineer"]);
    assert.deepEqual(JOBS_SYNONYMS["software engineer"], ["swe"]);
    assert.deepEqual(JOBS_SYNONYMS.k8s, ["kubernetes"]);
    assert.deepEqual(JOBS_SYNONYMS.kubernetes, ["k8s"]);
});

test("deriveSynonyms: a newly added abbreviation gets its reverse automatically", () => {
    // Proves the mechanism is class-wide, not hand-wired to today's four
    // abbreviations: this term does not exist in JOBS_SYNONYM_SOURCE.
    const derived = deriveSynonyms([{ term: "cto", expansions: ["chief technology officer"] }]);
    assert.deepEqual(derived.cto, ["chief technology officer"]);
    assert.deepEqual(derived["chief technology officer"], ["cto"]);
});

test("deriveSynonyms: oneWay suppresses the reverse for a multi-expansion fan-out", () => {
    const derived = deriveSynonyms([
        { term: "eng", expansions: ["engineering manager", "engineer"], oneWay: true },
    ]);
    assert.deepEqual(derived.eng, ["engineering manager", "engineer"]);
    assert.equal(derived["engineering manager"], undefined);
    assert.equal(derived["engineer"], undefined);
});

test("deriveSynonyms: a term declared twice merges without duplicating expansions", () => {
    const derived = deriveSynonyms([
        { term: "sre", expansions: ["site reliability engineer"] },
        { term: "sre", expansions: ["site reliability engineer", "reliability engineer"] },
    ]);
    assert.deepEqual(derived.sre, ["site reliability engineer", "reliability engineer"]);
});
