import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJobDocumentUrl } from "../../src/lib/jobs/get-job";

test("builds a document-by-primary-key URL, not a search URL", () => {
  const url = buildJobDocumentUrl("https://meili.example", "abc-123");
  assert.equal(url, "https://meili.example/indexes/jobs/documents/abc-123");
});

test("url-encodes the id so a hostile id cannot escape the path", () => {
  const url = buildJobDocumentUrl("https://meili.example", "a/../../keys");
  assert.ok(!url.includes("/../"), `id must be encoded, got ${url}`);
});

test("strips a trailing slash on the host rather than emitting a double slash", () => {
  const url = buildJobDocumentUrl("https://meili.example/", "abc");
  assert.equal(url, "https://meili.example/indexes/jobs/documents/abc");
});
