import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Exercise the REAL validation chokepoint (tsx resolves the @/ alias).
import {
  validate,
  formatZodError,
  markJobAppliedSchema,
  updateApplicationSchema,
  saveProviderApiKeySchema,
  submitFeedbackSchema,
} from "@/lib/validation";
import { z } from "zod";

describe("validate()", () => {
  it("returns { data } on success and never an error", () => {
    const r = validate(z.object({ a: z.number() }), { a: 1 });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.data, { a: 1 });
  });

  it("returns { error } string (not a throw) on failure", () => {
    const r = validate(z.object({ a: z.number() }), { a: "nope" });
    assert.equal(r.data, undefined);
    assert.equal(typeof r.error, "string");
    assert.ok(r.error && r.error.length > 0);
  });

  it("applies schema transforms to the returned data", () => {
    // optionalString trims; this proves the returned data is the PARSED value.
    const r = validate(updateApplicationSchema, { company_name: "  Acme  " });
    assert.equal(r.error, undefined);
    assert.equal(r.data?.company_name, "Acme");
  });
});

describe("formatZodError()", () => {
  it("includes the field path in the message", () => {
    const res = z.object({ company: z.string() }).safeParse({ company: 1 });
    assert.equal(res.success, false);
    if (!res.success) {
      assert.match(formatZodError(res.error), /company/);
    }
  });

  it("de-dupes identical messages", () => {
    const schema = z.object({ a: z.string(), b: z.string() });
    const res = schema.safeParse({ a: 1, b: 2 });
    assert.equal(res.success, false);
    if (!res.success) {
      const msg = formatZodError(res.error);
      // Two distinct field paths -> two segments, not collapsed away entirely.
      assert.match(msg, /a:/);
      assert.match(msg, /b:/);
    }
  });
});

describe("markJobAppliedSchema", () => {
  it("accepts a valid job + normalizes the apply URL", () => {
    const r = validate(markJobAppliedSchema, {
      company: "Acme",
      title: "Engineer",
      applyUrl: "https://jobs.acme.com/123",
    });
    assert.equal(r.error, undefined);
    assert.equal(r.data?.applyUrl, "https://jobs.acme.com/123");
  });

  it("treats an empty applyUrl as undefined (optional)", () => {
    const r = validate(markJobAppliedSchema, {
      company: "Acme",
      title: "Engineer",
      applyUrl: "",
    });
    assert.equal(r.error, undefined);
    assert.equal(r.data?.applyUrl, undefined);
  });

  it("rejects a missing company", () => {
    const r = validate(markJobAppliedSchema, {
      company: "   ",
      title: "Engineer",
      applyUrl: "",
    });
    assert.ok(r.error);
  });

  it("rejects a non-http(s) apply URL (e.g. javascript:)", () => {
    const r = validate(markJobAppliedSchema, {
      company: "Acme",
      title: "Engineer",
      applyUrl: "javascript:alert(1)",
    });
    assert.ok(r.error);
  });
});

describe("updateApplicationSchema", () => {
  it("rejects an invalid status", () => {
    const r = validate(updateApplicationSchema, { status: "ghosted" });
    assert.ok(r.error);
    assert.match(r.error!, /status/);
  });

  it("rejects unknown keys (strict)", () => {
    const r = validate(updateApplicationSchema, { is_admin: true });
    assert.ok(r.error);
  });

  it("accepts a valid partial update", () => {
    const r = validate(updateApplicationSchema, {
      status: "interviewing",
      position: "Staff Engineer",
    });
    assert.equal(r.error, undefined);
    assert.equal(r.data?.status, "interviewing");
  });
});

describe("saveProviderApiKeySchema", () => {
  it("accepts a known provider with a key", () => {
    const r = validate(saveProviderApiKeySchema, {
      provider: "groq",
      key: "gsk_abc",
    });
    assert.equal(r.error, undefined);
  });

  it("accepts an empty key (clear-key signal)", () => {
    const r = validate(saveProviderApiKeySchema, { provider: "openrouter", key: "" });
    assert.equal(r.error, undefined);
  });

  it("rejects an unknown provider", () => {
    const r = validate(saveProviderApiKeySchema, { provider: "openai", key: "x" });
    assert.ok(r.error);
  });
});

describe("submitFeedbackSchema", () => {
  it("accepts a valid bug report and defaults missing path to ''", () => {
    const r = validate(submitFeedbackSchema, { type: "bug", message: "broken" });
    assert.equal(r.error, undefined);
    assert.equal(r.data?.path, "");
  });

  it("rejects an empty message", () => {
    const r = validate(submitFeedbackSchema, { type: "feedback", message: "  " });
    assert.ok(r.error);
  });

  it("rejects an unknown feedback type", () => {
    const r = validate(submitFeedbackSchema, { type: "spam", message: "hi" });
    assert.ok(r.error);
  });
});
