import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildJobFeaturesSelect } from "../../src/lib/telemetry/job-features-columns";
import { aggregateFeatureOutcomes, type OutcomeEventRow } from "../../src/lib/telemetry/feature-outcomes";
import type { JobFeatures } from "../../src/lib/telemetry/features";

describe("buildJobFeaturesSelect — bounded job_features lookup", () => {
  it("filters by job_id = any($1::text[]) instead of a bare full-table select", () => {
    const { text, params } = buildJobFeaturesSelect(["job-1", "job-2"]);
    assert.match(text, /where job_id = any\(\$1::text\[\]\)/);
    assert.equal(params.length, 1);
    assert.deepEqual(params[0], ["job-1", "job-2"]);
  });

  it("passes the exact job_id list through as the single bound param, unmodified", () => {
    const ids = ["job-a", "job-b", "job-a"]; // dedup is the caller's job, not the builder's
    const { params } = buildJobFeaturesSelect(ids);
    assert.deepEqual(params[0], ids);
  });

  // Generic-fix case: an empty window must still build syntactically valid,
  // bounded SQL — never a full-table scan and never a syntax error.
  it("an empty job_id list still builds a bounded (not full-table) query", () => {
    const { text, params } = buildJobFeaturesSelect([]);
    assert.match(text, /where job_id = any\(\$1::text\[\]\)/);
    assert.deepEqual(params, [[]]);
  });
});

describe("aggregateFeatureOutcomes — job_id absent from the (now-bounded) features map", () => {
  // Generic-fix case: an outcome event can reference a job_id that has no
  // job_features row (e.g. the job was delisted after the event fired, or
  // build-job-features hasn't run yet). Bounding the SELECT to only the
  // window's job_ids must not change this: the row is still looked up by
  // job_id and still skipped via `if (!features) continue`, never crashing
  // and never fabricating a feature set.
  it("skips an event whose job_id has no row in the features map", () => {
    const events: OutcomeEventRow[] = [
      { job_id: "job-missing", position: 3, kind: "click" },
    ];
    const featuresByJobId = new Map<string, JobFeatures>(); // empty — as if the id was never in the fetch result
    const rows = aggregateFeatureOutcomes(events, featuresByJobId);
    assert.deepEqual(rows, []);
  });
});
