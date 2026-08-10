import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJobIdFilter, buildJobSearchUrl } from "../../src/lib/jobs/get-job";

test("builds a search URL, not a get-document-by-primary-key URL", () => {
  const url = buildJobSearchUrl("https://meili.example");
  assert.equal(url, "https://meili.example/indexes/jobs/search");
});

test("strips a trailing slash on the host rather than emitting a double slash", () => {
  const url = buildJobSearchUrl("https://meili.example/");
  assert.equal(url, "https://meili.example/indexes/jobs/search");
});

test("id filter quotes a plain id", () => {
  const filter = buildJobIdFilter("abc-123");
  assert.equal(filter, 'id = "abc-123"');
});

test("id filter escapes a hostile id so it cannot break out of the string literal", () => {
  const hostile = 'abc" OR "1"="1';
  const filter = buildJobIdFilter(hostile);
  // The only unescaped quotes are the two that open/close the filter's own
  // string literal — every quote from the hostile input is backslash-escaped.
  assert.equal(filter, 'id = "abc\\" OR \\"1\\"=\\"1"');
  const unescapedQuotes = filter.replace(/\\"/g, "").match(/"/g) ?? [];
  assert.equal(unescapedQuotes.length, 2, `expected exactly 2 unescaped quotes, got ${filter}`);
});
