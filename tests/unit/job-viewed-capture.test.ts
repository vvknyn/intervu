import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJobViewedPayload } from "../../src/lib/analytics/use-job-viewed-capture";

// A résumé-scored view used to add match_label / match_score / match_band here.
// The builder takes no résumé and no score, so these are the only keys it can emit.
test("job_viewed payload is the job and its source, nothing about the viewer", () => {
  assert.deepEqual(buildJobViewedPayload({ id: "job-1", company_domain: "acme.com" }, "serp"), {
    job_id: "job-1",
    company_domain: "acme.com",
    source: "serp",
  });
  assert.deepEqual(buildJobViewedPayload({ id: "job-2", company_domain: null }, "direct"), {
    job_id: "job-2",
    company_domain: null,
    source: "direct",
  });
});
