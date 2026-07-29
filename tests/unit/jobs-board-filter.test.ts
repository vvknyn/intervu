import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFilter } from "../../src/lib/jobs/meilisearch";

describe("buildFilter board", () => {
  it("adds company_domain IN clause for elite", () => {
    const f = buildFilter({ board: "elite", hideGhosts: true });
    const clause = f.find((c) => c.startsWith("company_domain IN"));
    assert.ok(clause, `expected IN clause in ${JSON.stringify(f)}`);
    assert.ok(clause.includes("company_domain IN ["));
  });
  it("omits board clause when board unset", () => {
    const f = buildFilter({ hideGhosts: true });
    assert.ok(!f.some((c) => c.includes("company_domain")));
  });
});
