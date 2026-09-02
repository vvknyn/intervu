import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPostHogClientReady,
  reportListingFeedback,
  triggerReportListingClick,
  triggerReportListingWithRetry,
  type PostHogReportClient,
} from "../../src/lib/analytics/report-listing-trigger";

const JOB = {
  id: "job-123",
  title: "Backend Engineer",
  company: "Acme Inc.",
  company_domain: "acme.example",
  apply_url: "https://acme.example/jobs/1",
};

function mockClient(loaded = true): PostHogReportClient & { calls: { register: unknown[]; capture: unknown[] } } {
  const calls = { register: [] as unknown[], capture: [] as unknown[] };
  return {
    __loaded: loaded,
    register(props) {
      calls.register.push(props);
    },
    capture(event, props) {
      calls.capture.push({ event, props });
    },
    calls,
  };
}

test("triggerReportListingClick captures job_report_clicked when PostHog is loaded", () => {
  const client = mockClient(true);
  const result = triggerReportListingClick(client, JOB, "https://velai.app", true);
  assert.equal(result.status, "triggered");
  assert.equal(client.calls.capture.length, 1);
  assert.deepEqual(client.calls.capture[0], {
    event: "job_report_clicked",
    props: {
      job_id: "job-123",
      job_title: "Backend Engineer",
      company: "Acme",
      job_url: "https://velai.app/jobs/backend-engineer-at-acme-inc-job-123",
    },
  });
  assert.deepEqual(client.calls.register[0], {
    reported_job_id: "job-123",
    reported_job_title: "Backend Engineer",
    reported_company: "Acme",
  });
});

test("triggerReportListingClick returns not_loaded when the SDK is still booting", () => {
  const client = mockClient(false);
  const result = triggerReportListingClick(client, JOB, "https://velai.app", true);
  assert.equal(result.status, "not_loaded");
  assert.equal(client.calls.capture.length, 0);
});

test("triggerReportListingClick returns unconfigured when analytics is disabled", () => {
  const client = mockClient(true);
  const result = triggerReportListingClick(client, JOB, "https://velai.app", false);
  assert.equal(result.status, "unconfigured");
  assert.equal(client.calls.capture.length, 0);
});

test("isPostHogClientReady requires the SDK loaded latch", () => {
  assert.equal(isPostHogClientReady(null), false);
  assert.equal(isPostHogClientReady(mockClient(false)), false);
  assert.equal(isPostHogClientReady(mockClient(true)), true);
});

test("triggerReportListingWithRetry waits for PostHog to finish loading", async () => {
  const client = mockClient(false);
  setTimeout(() => {
    client.__loaded = true;
  }, 100);

  const result = await triggerReportListingWithRetry(
    () => client,
    JOB,
    "https://velai.app",
    true,
    { attempts: 5, delayMs: 50 },
  );

  assert.equal(result.status, "triggered");
  assert.equal(client.calls.capture.length, 1);
});

test("reportListingFeedback surfaces loading and failure copy", () => {
  assert.equal(reportListingFeedback({ status: "not_loaded" }, true), "Loading report form…");
  assert.equal(
    reportListingFeedback({ status: "not_loaded" }, false),
    "Report listing isn't ready yet. Try again.",
  );
  assert.equal(
    reportListingFeedback({ status: "unconfigured" }, false),
    "Report listing isn't available right now.",
  );
  assert.equal(reportListingFeedback({ status: "aborted" }, false), null);
});

test("triggerReportListingWithRetry aborts stale retry loops", async () => {
  const client = mockClient(false);
  const controller = new AbortController();
  controller.abort();
  const result = await triggerReportListingWithRetry(
    () => client,
    JOB,
    "https://velai.app",
    true,
    { attempts: 5, delayMs: 50 },
    controller.signal,
  );
  assert.equal(result.status, "aborted");
  assert.equal(client.calls.capture.length, 0);
});
