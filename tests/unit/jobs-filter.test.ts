import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFilter, REMOTE_ANYWHERE_CLAUSE } from "../../src/lib/jobs/meilisearch";
import { resolveLocationFacet } from "../../src/lib/jobs/query-understanding";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import type { CorpusValueChecker } from "../../src/lib/geo/corpus-values";
import type { LocationVocabulary } from "../../src/lib/jobs/query-understanding";
import type { PlaceFilter } from "../../src/lib/jobs/types";

const CANADA_VOCAB_DATA: GazetteerData = {
  countries: [["CA", "CAN", "Canada"]],
  admin1: [],
  cities: [],
};
const CANADA_GAZETTEER = buildGazetteerIndex(CANADA_VOCAB_DATA);

function canadaVocab(): LocationVocabulary {
  const realValues: PlaceFilter[] = [{ field: "location_country", value: "Canada" }];
  const checker: CorpusValueChecker = async (groups) =>
    groups.map((candidates) => {
      const out: PlaceFilter[] = [];
      for (const c of candidates) {
        const hit = realValues.find(
          (v) => v.field === c.field && v.value.toLowerCase() === c.value.toLowerCase(),
        );
        if (hit) out.push(hit);
      }
      return out;
    });
  return { gazetteer: CANADA_GAZETTEER, corpusChecker: checker, companyProbe: async () => false };
}

test("hideGhosts adds the ghost exclusion clause", () => {
    const f = buildFilter({ hideGhosts: true });
    assert.ok(f.some((c) => c.includes("ghost_badge !=") && c.includes("likely_ghost")), JSON.stringify(f));
});

test("hideGhosts absent/false adds no ghost clause", () => {
    for (const p of [{}, { hideGhosts: false }]) {
        const f = buildFilter(p);
        assert.ok(!f.some((c) => c.includes("ghost_badge !=")), JSON.stringify(f));
    }
});

test("hideGhosts composes with an explicit ghost_badge facet", () => {
    const f = buildFilter({ hideGhosts: true, facets: { ghost_badge: ["clear"] } });
    assert.ok(f.some((c) => c.includes("ghost_badge !=")));
    assert.ok(f.some((c) => c.includes('"clear"') || c.includes("'clear'") || c.includes("= clear")), JSON.stringify(f));
});

// countNewSinceAction's posted_ts chokepoint (actions/jobs.ts) — an
// absolute cursor floor, expressed through the SAME buildFilter translation
// postedBucket already uses, not a hand-built filter string.
test("postedSinceMs adds an absolute posted_ts >= floor clause", () => {
    const f = buildFilter({ postedSinceMs: 1_800_000_000_000 });
    assert.ok(f.some((c) => c === "posted_ts >= 1800000000000"), JSON.stringify(f));
});

test("postedSinceMs absent adds no posted_ts clause", () => {
    const f = buildFilter({});
    assert.ok(!f.some((c) => c.includes("posted_ts")), JSON.stringify(f));
});

test("postedSinceMs and postedBucket compose additively (both clauses present) when both are set", () => {
    const f = buildFilter({ postedBucket: "7d", postedSinceMs: 1_800_000_000_000 });
    assert.ok(f.some((c) => c.startsWith("posted_ts >= ") && c.includes("1800000000000")), JSON.stringify(f));
    assert.ok(f.filter((c) => c.includes("posted_ts")).length === 2, JSON.stringify(f));
});

test("postedSinceMs drops out under the TRANSITIONAL legacy retry, same as postedBucket", () => {
    const f = buildFilter({ postedSinceMs: 1_800_000_000_000 }, true);
    assert.ok(!f.some((c) => c.includes("posted_ts")), JSON.stringify(f));
});

test("facet object-key order does not change the filter array", () => {
    const a = buildFilter({
        facets: { experience_level: ["senior"], work_type: ["remote"] },
    });
    const b = buildFilter({
        facets: { work_type: ["remote"], experience_level: ["senior"] },
    });
    assert.deepEqual(a, b);
});

test("duplicate facet values produce one OR predicate per value", () => {
    const f = buildFilter({ facets: { experience_level: ["senior", "senior", "mid"] } });
    const levelClauses = f.filter((c) => c.includes("experience_level"));
    assert.equal(levelClauses.length, 1);
    assert.equal((levelClauses[0].match(/senior/g) ?? []).length, 1);
    assert.ok(levelClauses[0].includes("mid"));
});

test("reversed value selection order canonicalizes to the same filter", () => {
    const forward = buildFilter({ facets: { work_type: ["remote", "hybrid"] } });
    const reversed = buildFilter({ facets: { work_type: ["hybrid", "remote"] } });
    assert.deepEqual(forward, reversed);
});

test("filter clauses are commutative — facet object key order does not change the clause set", () => {
    const forward = buildFilter({
        facets: { work_type: ["remote"], experience_level: ["senior"] },
    });
    const reversed = buildFilter({
        facets: { experience_level: ["senior"], work_type: ["remote"] },
    });
    assert.deepEqual([...forward].sort(), [...reversed].sort());
});

// tech_stack / must_have_skills ride the SAME generic FACETABLE_KEYS loop as
// every other categorical facet above — proven here rather than assumed, so
// a future change to that loop can't silently stop covering them.
test("tech_stack and must_have_skills compose through the generic facet loop, same as any other facet", () => {
    const f = buildFilter({ facets: { tech_stack: ["Python", "Rust"], must_have_skills: ["SQL"] } });
    const techClause = f.find((c) => c.includes("tech_stack"));
    const skillsClause = f.find((c) => c.includes("must_have_skills"));
    assert.ok(techClause, JSON.stringify(f));
    assert.ok(skillsClause, JSON.stringify(f));
    assert.ok(techClause!.includes('"Python"') && techClause!.includes('"Rust"'));
    assert.ok(skillsClause!.includes('"SQL"'));
});

// Years-of-experience: a REQUIRED missing-field union, not an edge case —
// backfill coverage is ~47% and draining (see JobSearchParams.yearsExperience),
// so a bare range clause would silently hide most of the corpus.
test("yearsExperience composes a range clause OR'd with NOT EXISTS, for every finite bucket", () => {
    const cases: [string, string, string][] = [
        ["0-2", "min_years_experience >= 0", "min_years_experience <= 2"],
        ["3-5", "min_years_experience >= 3", "min_years_experience <= 5"],
        ["6-10", "min_years_experience >= 6", "min_years_experience <= 10"],
    ];
    for (const [bucket, lo, hi] of cases) {
        const f = buildFilter({ yearsExperience: bucket as never });
        const clause = f.find((c) => c.includes("min_years_experience"));
        assert.ok(clause, `${bucket}: ${JSON.stringify(f)}`);
        assert.ok(clause!.includes(lo) && clause!.includes(hi), `${bucket}: ${clause}`);
        assert.ok(clause!.includes("min_years_experience NOT EXISTS"), `${bucket}: ${clause}`);
    }
});

test("yearsExperience's open-ended top bucket (11+) has no upper bound, still unions with NOT EXISTS", () => {
    const f = buildFilter({ yearsExperience: "11+" });
    const clause = f.find((c) => c.includes("min_years_experience"));
    assert.ok(clause, JSON.stringify(f));
    assert.equal(clause, "(min_years_experience >= 11 OR min_years_experience NOT EXISTS)");
});

test("yearsExperience absent adds no min_years_experience clause", () => {
    const f = buildFilter({});
    assert.ok(!f.some((c) => c.includes("min_years_experience")), JSON.stringify(f));
});

test("yearsExperience composes with an unrelated facet — proves the class, not a lone special case", () => {
    const f = buildFilter({ yearsExperience: "6-10", facets: { work_type: ["remote"] } });
    assert.ok(f.some((c) => c.includes("min_years_experience") && c.includes("NOT EXISTS")), JSON.stringify(f));
    assert.ok(f.some((c) => c.includes("work_type") && c.includes("remote")), JSON.stringify(f));
});

test("postedBucket 1d AND a resolved Canada place both reach buildFilter — Past 24h cannot drop location", async () => {
    const p = await resolveLocationFacet(
        { facets: { location_country: ["Canada"] }, postedBucket: "1d" },
        canadaVocab(),
    );
    const f = buildFilter(p);
    assert.ok(f.some((c) => c.startsWith("posted_ts >= ")), JSON.stringify(f));
    assert.ok(
        f.some((c) => c.includes('location_country = "Canada"')),
        `expected Canada place clause alongside posted_ts: ${JSON.stringify(f)}`,
    );
    assert.ok(
        !f.some((c) => c.includes(REMOTE_ANYWHERE_CLAUSE)),
        `explicit Canada must not OR untagged remotes: ${JSON.stringify(f)}`,
    );
});
