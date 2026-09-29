import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildFilter } from "../../src/lib/jobs/meilisearch";
import { searchParamsFromUrlState } from "../../src/lib/jobs/search-payload";
import { DEFAULT_URL_STATE } from "../../src/lib/jobs/url-state";
import { resolveCandidateSignals } from "../../src/lib/jobs/candidate-signals";
import { scoreJobAgainstResume, levelUnverified } from "../../src/lib/match/score";
import { facetFilterClause, facetValueMatches, isUnknownFacetValue } from "../../src/lib/jobs/unknown-inclusive-facets";
import { mkJob, mkResume } from "../support/jobs-corpus-stub";

const clauseFor = (facets: Record<string, string[]>) =>
  buildFilter(searchParamsFromUrlState({ ...DEFAULT_URL_STATE, facets })).filter((c) => !c.startsWith("vacancy_status"));

describe("a seniority selection also matches un-derived levels (ruling 20:10)", () => {
  it("manual URL state: every selected level, plus unknown / null / absent", () => {
    for (const level of ["entry", "senior", "lead"]) {
      const [clause] = clauseFor({ experience_level: [level] });
      assert.ok(clause.includes(`experience_level = "${level}"`), clause);
      for (const unknown of ['experience_level = "unknown"', "experience_level IS NULL", "experience_level NOT EXISTS"]) {
        assert.ok(clause.includes(unknown), `${level}: ${clause}`);
      }
    }
  });

  it("a bare facets bag (MCP search_jobs, hub counts, count route all pass one) builds the same clause as the /jobs URL state", () => {
    const [urlClause] = clauseFor({ experience_level: ["senior"] });
    assert.deepEqual(buildFilter({ facets: { experience_level: ["senior"] } }).slice(1), [urlClause]);
  });

  it("an explicit 'unknown' selection is not duplicated", () => {
    const [clause] = clauseFor({ experience_level: ["unknown", "mid"] });
    assert.equal(clause.match(/experience_level = "unknown"/g)?.length, 1, clause);
  });

  it("facets without a never-derived value keep their plain OR clause", () => {
    assert.deepEqual(buildFilter({ facets: { work_type: ["remote", "hybrid"] } }).slice(1), ['(work_type = "hybrid" OR work_type = "remote")']);
  });
});

describe("in-memory predicate mirrors the Meili clause", () => {
  it("matches the level, the sentinel, and absence; refuses a different known level", () => {
    assert.equal(facetValueMatches("experience_level", "senior", ["senior"]), true);
    assert.equal(facetValueMatches("experience_level", "unknown", ["senior"]), true);
    assert.equal(facetValueMatches("experience_level", null, ["senior"]), true);
    assert.equal(facetValueMatches("experience_level", "mid", ["senior"]), false);
    assert.equal(facetValueMatches("work_type", "onsite", ["remote"]), false);
    assert.equal(facetValueMatches("work_type", null, ["remote"]), false, "work_type has no unknown-inclusive rule");
    assert.equal(isUnknownFacetValue("work_type", "unknown"), false);
    assert.equal(facetFilterClause("work_type", ["remote"]), '(work_type = "remote")');
  });
});

describe("unknown-level rows rank lower and never claim the level", () => {
  const resume = mkResume({ yearsOfExperience: 5, location: "Toronto, Canada" });
  const signals = resolveCandidateSignals(resume);
  it("cannot read as Strong for a candidate with a known level, and the seniority component says unknown", () => {
    const known = scoreJobAgainstResume(resume, mkJob("k", { experience_level: "mid", location_country: "Canada", work_type: "remote" }), signals)!;
    const unknown = scoreJobAgainstResume(resume, mkJob("u", { experience_level: "unknown", location_country: "Canada", work_type: "remote" }), signals)!;
    assert.ok(unknown.total < known.total);
    assert.ok(unknown.total < 80);
    assert.equal(unknown.components.find((c) => c.key === "seniority")!.unknown, true);
  });
  it("a candidate with no known level is not demoted against any job", () => {
    const noLevel = resolveCandidateSignals(mkResume({ yearsOfExperience: undefined as unknown as number }));
    assert.equal(levelUnverified(noLevel, mkJob("u", { experience_level: "unknown" })), false);
  });
});

/** Gate, no file allowlist: a hand-written `experience_level = "..."` filter bypasses the unknown-inclusive rule. */
describe("no hand-rolled level filter", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  it("every experience_level equality outside buildFilter's helper carries an on-line exemption reason", () => {
    const offenders = walk(join(__dirname, "../../src")).flatMap((file) =>
      readFileSync(file, "utf8").split("\n").flatMap((line, i) =>
        /experience_level\s*=\s*\\?["']/.test(line) && !/unknown-inclusive-exempt: \S/.test(line)
          ? [`${file}:${i + 1}`]
          : [],
      ),
    );
    assert.deepEqual(offenders, []);
  });
});
