import { test } from "node:test";
import assert from "node:assert/strict";
import { jobShareUrl } from "../../src/lib/jobs/share-url";

/** R6 (2026-08-09 founder report): one URL builder shared by the board's
 *  own "Copy link" button (CopyJobLinkButton, JobDetail.tsx — client,
 *  window.location.origin) and the MCP search_jobs/get_job tools
 *  (agent/tools.ts — server, AGENT.issuer()), so an agent-shared link and a
 *  web-copied link are byte-identical. */

test("builds the /jobs?job=<id> deep link the board reads back (app/jobs/page.tsx)", () => {
  assert.equal(jobShareUrl("https://intervu.cc", "job-1"), "https://intervu.cc/jobs?job=job-1");
});

test("strips a trailing slash on the origin so the path never double-slashes", () => {
  assert.equal(jobShareUrl("https://intervu.cc/", "job-1"), "https://intervu.cc/jobs?job=job-1");
});

test("class case: a job id with special characters (space, &, /) is percent-encoded, never breaking the URL", () => {
  const url = jobShareUrl("https://intervu.cc", "abc 123&x/y");
  assert.equal(url, "https://intervu.cc/jobs?job=abc%20123%26x%2Fy");
  // Round-trips cleanly back to the original id.
  assert.equal(decodeURIComponent(new URL(url).searchParams.get("job")!), "abc 123&x/y");
});

test("works identically off a local dev origin (no path assumptions baked in)", () => {
  assert.equal(jobShareUrl("http://localhost:3000", "job-9"), "http://localhost:3000/jobs?job=job-9");
});
