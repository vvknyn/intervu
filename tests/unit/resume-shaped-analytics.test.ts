import { test } from "node:test";
import assert from "node:assert/strict";
import { listShapedByResume, type FitApplication } from "../../src/lib/jobs/for-you/pack-filters";
import { resultClickedPayload, resultsImpressedPayload } from "../../src/lib/analytics/result-payloads";

const impressions = [
  { jobId: "a", position: 1 },
  { jobId: "b", position: 2 },
];
const derived: FitApplication = { q: "nurse", facets: {}, postedBucket: "30d" as never, keepUserWindow: false };

test("a fit-ranked list is résumé-shaped: no position, no impressed ids, job_id kept on a click", () => {
  const shaped = listShapedByResume(true, null);
  assert.equal(shaped, true);
  const click = resultClickedPayload({ jobId: "a", position: 3, resumeShaped: shaped }, {});
  assert.deepEqual(click, { job_id: "a", source: "serp" });
  assert.deepEqual(resultsImpressedPayload(impressions, { source: "serp", queryId: "q1", resumeShaped: shaped }), {
    count: 2,
    source: "serp",
    query_id: "q1",
  });
});

test("a list built from résumé-derived filters is résumé-shaped even when the sort is not fit", () => {
  const shaped = listShapedByResume(false, derived);
  assert.equal(shaped, true);
  assert.equal("position" in resultClickedPayload({ jobId: "a", position: 3, resumeShaped: shaped }, {}), false);
  const imp = resultsImpressedPayload(impressions, { source: "serp", queryId: "", resumeShaped: shaped });
  assert.equal("job_ids" in imp || "positions" in imp, false);
});

test("a plain keyword search with no résumé keeps position and the impressed ids", () => {
  const shaped = listShapedByResume(false, null);
  assert.equal(shaped, false);
  assert.deepEqual(resultClickedPayload({ jobId: "a", position: 3, resumeShaped: shaped }, { query_id: "q1" }), {
    position: 3,
    job_id: "a",
    source: "serp",
    query_id: "q1",
  });
  assert.deepEqual(resultsImpressedPayload(impressions, { source: "serp", queryId: "q1", resumeShaped: shaped }), {
    job_ids: ["a", "b"],
    positions: [1, 2],
    count: 2,
    source: "serp",
    query_id: "q1",
  });
});
