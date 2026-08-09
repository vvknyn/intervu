import { test } from "node:test";
import assert from "node:assert/strict";
import { jobShareUrl } from "../../src/lib/jobs/share-url";

/** R6 (2026-08-09 founder report): one URL builder shared by the board's
 *  own "Copy link" button (CopyJobLinkButton, JobDetail.tsx — client,
 *  window.location.origin) and the MCP search_jobs/get_job tools
 *  (agent/tools.ts — server, AGENT.issuer()), so an agent-shared link and a
 *  web-copied link are byte-identical. Now delegates to `jobPath`
 *  (job-slug.ts) for the canonical, indexable `/jobs/<slug>-<uuid>` shape —
 *  see job-slug.test.ts for slug-building coverage; these tests cover the
 *  origin-joining behaviour this function itself owns. */

const JOB = { id: "f7357d0c-fae4-4f2e-a850-c46d991efba3", title: "Data Engineer", company: "Orange" };

test("builds the canonical /jobs/<slug>-<uuid> URL jobPath produces", () => {
  assert.equal(jobShareUrl("https://intervu.cc", JOB), `https://intervu.cc/jobs/data-engineer-at-orange-${JOB.id}`);
});

test("strips a trailing slash on the origin so the path never double-slashes", () => {
  assert.equal(jobShareUrl("https://intervu.cc/", JOB), `https://intervu.cc/jobs/data-engineer-at-orange-${JOB.id}`);
});

test("class case: special characters in title/company are slugified away, never breaking the URL", () => {
  const url = jobShareUrl("https://intervu.cc", { id: JOB.id, title: "QA & Test (Remote!)", company: "Acme, Inc." });
  assert.equal(url, `https://intervu.cc/jobs/qa-test-remote-at-acme-inc-${JOB.id}`);
});

test("works identically off a local dev origin (no path assumptions baked in)", () => {
  assert.equal(jobShareUrl("http://localhost:3000", JOB), `http://localhost:3000/jobs/data-engineer-at-orange-${JOB.id}`);
});

test("omits the company segment when company is null, matching jobPath", () => {
  assert.equal(
    jobShareUrl("https://intervu.cc", { id: JOB.id, title: "Data Engineer", company: null }),
    `https://intervu.cc/jobs/data-engineer-${JOB.id}`,
  );
});
