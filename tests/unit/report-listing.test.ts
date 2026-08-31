import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReportListingPayload,
  reportListingCompany,
} from "../../src/lib/analytics/report-listing";

const ORIGIN = "https://velai.app";

test("reportListingCompany prefers the display brand, then domain, then raw name", () => {
  assert.equal(
    reportListingCompany({
      company: "Acme Inc.",
      company_domain: "acme.example",
      title: "Engineer",
    }),
    "Acme",
  );
  assert.equal(
    reportListingCompany({
      company: null,
      company_domain: "stripe.com",
      title: "Engineer",
    }),
    "Stripe",
  );
});

test("buildReportListingPayload registers job context and captures the survey event contract", () => {
  const jobId = "f7357d0c-fae4-4f2e-a850-c46d991efba3";
  const payload = buildReportListingPayload(
    {
      id: jobId,
      title: "Backend Engineer",
      company: "Acme Inc.",
      company_domain: "acme.example",
      apply_url: "https://acme.example/jobs/1",
    },
    ORIGIN,
  );

  assert.deepEqual(payload.register, {
    reported_job_id: jobId,
    reported_job_title: "Backend Engineer",
    reported_company: "Acme",
  });
  assert.deepEqual(payload.capture, {
    job_id: jobId,
    job_title: "Backend Engineer",
    company: "Acme",
    job_url: `${ORIGIN}/jobs/backend-engineer-at-acme-inc-${jobId}`,
  });
});

test("buildReportListingPayload falls back to apply_url when origin is absent", () => {
  const payload = buildReportListingPayload(
    {
      id: "job-456",
      title: "Designer",
      company: "Beta",
      company_domain: null,
      apply_url: "https://beta.example/apply",
    },
    "",
  );

  assert.equal(payload.capture.job_url, "https://beta.example/apply");
});
