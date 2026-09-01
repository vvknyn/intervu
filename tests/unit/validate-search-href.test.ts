import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateSearchAlertHref,
  jobsUrlStateFromSearchAlertHref,
} from "../../src/lib/identity/validate-search-href";

describe("validateSearchAlertHref", () => {
  it("accepts /jobs with no query", () => {
    const result = validateSearchAlertHref("/jobs");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.href, "/jobs");
      assert.equal(typeof result.searchHash, "string");
      assert.ok(result.searchHash.length > 0);
    }
  });

  it("accepts /jobs?q=engineer", () => {
    const result = validateSearchAlertHref("/jobs?q=engineer");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.href, "/jobs?q=engineer");
      assert.equal(typeof result.searchHash, "string");
    }
  });

  it("trims whitespace", () => {
    const result = validateSearchAlertHref("  /jobs?q=pm  ");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.href, "/jobs?q=pm");
  });

  it("rejects non-jobs paths", () => {
    assert.deepEqual(validateSearchAlertHref("/co/acme"), { ok: false });
    assert.deepEqual(validateSearchAlertHref("https://evil.com/jobs?q=x"), { ok: false });
  });

  it("rejects href longer than 2048 chars", () => {
    assert.deepEqual(validateSearchAlertHref(`/jobs?${"a".repeat(2048)}`), { ok: false });
  });

  it("rejects empty string", () => {
    assert.deepEqual(validateSearchAlertHref("   "), { ok: false });
  });
});

describe("jobsUrlStateFromSearchAlertHref", () => {
  it("parses /jobs?q=engineer into search state", () => {
    const state = jobsUrlStateFromSearchAlertHref("/jobs?q=engineer");
    assert.equal(state.q, "engineer");
  });

  it("parses bare /jobs as empty query", () => {
    const state = jobsUrlStateFromSearchAlertHref("/jobs");
    assert.equal(state.q, "");
  });
});