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

  it("facets outside the registry keep their plain OR clause", () => {
    assert.deepEqual(buildFilter({ facets: { employment_type: ["full_time", "contract"] } }).slice(1), ['(employment_type = "contract" OR employment_type = "full_time")']);
  });

  it("work mode (ruling 2026-10-22) keeps un-derived rows like seniority does", () => {
    const [clause] = buildFilter({ facets: { work_type: ["remote", "hybrid"] } }).slice(1);
    for (const t of ['work_type = "hybrid"', 'work_type = "remote"', 'work_type = "unknown"', "work_type IS NULL", "work_type NOT EXISTS"]) {
      assert.ok(clause.includes(t), clause);
    }
  });

  it("a salary floor keeps postings with no stated salary", () => {
    for (const min of [60_000, 150_000]) {
      const [clause] = buildFilter({ salaryMin: min }).slice(1);
      assert.ok(clause.includes(`salary_max >= ${min} OR salary_min >= ${min}`), clause);
      for (const t of ["salary_max IS NULL", "salary_max NOT EXISTS", "salary_min IS NULL", "salary_min NOT EXISTS"]) assert.ok(clause.includes(t), clause);
    }
  });

  it("knownOnly builds the strict twin of every unknown-inclusive clause; the posted window is strict either way", () => {
    const p = { salaryMin: 90_000, facets: { work_type: ["remote"], experience_level: ["senior"] }, postedBucket: "7d" as const };
    const strict = buildFilter(p, false, { knownOnly: true }).join(" | ");
    assert.ok(!/unknown|IS NULL|NOT EXISTS/.test(strict), strict);
    const inclusive = buildFilter(p).join(" | ");
    assert.ok(/posted_ts >= \d+/.test(inclusive) && !/posted_ts IS NULL|posted_ts NOT EXISTS/.test(inclusive), inclusive);
  });
});

describe("in-memory predicate mirrors the Meili clause", () => {
  it("matches the level, the sentinel, and absence; refuses a different known level", () => {
    assert.equal(facetValueMatches("experience_level", "senior", ["senior"]), true);
    assert.equal(facetValueMatches("experience_level", "unknown", ["senior"]), true);
    assert.equal(facetValueMatches("experience_level", null, ["senior"]), true);
    assert.equal(facetValueMatches("experience_level", "mid", ["senior"]), false);
    assert.equal(facetValueMatches("work_type", "onsite", ["remote"]), false);
    assert.equal(facetValueMatches("work_type", null, ["remote"]), true);
    assert.equal(facetValueMatches("work_type", "unknown", ["remote"]), true);
    assert.equal(isUnknownFacetValue("employment_type", "unknown"), false, "unregistered facets stay strict");
    assert.equal(facetFilterClause("employment_type", ["contract"]), '(employment_type = "contract")');
    assert.equal(facetFilterClause("work_type", ["remote"], true), '(work_type = "remote")');
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
