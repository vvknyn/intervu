import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { POST as contactPost } from "../../src/app/api/contact/route";
import { GET as suggestGet, jobsSuggestRateLimitedBody } from "../../src/app/api/jobs/suggest/route";
import { GET as locationsGet, jobsLocationRateLimitedBody } from "../../src/app/api/jobs/locations/route";
import {
  allowJobsLocationRequest,
  allowJobsSuggestRequest,
  clearRateLimitStateForTests,
  JOBS_LOCATION_WINDOW_MS,
  JOBS_LOCATION_MAX_REQUESTS,
  JOBS_SUGGEST_MAX_REQUESTS,
  JOBS_SUGGEST_WINDOW_MS,
  typeaheadRetryAfterHeader,
} from "../../src/lib/shield/rate-limit";
import { renderEmailShellHtml, renderEmailShellText } from "../../src/lib/email/templates/base";
import { PUBLIC_SUPPORT_EMAIL } from "../../src/lib/legal/public-contact";
import { processBatch } from "../../src/lib/telemetry/ingest";

describe("POST /api/resume/pdf — 503 body", () => {
  it("buildResumePdfUnavailableBody exposes only the public error envelope", async () => {
    const { buildResumePdfUnavailableBody } = await import("../../src/app/api/resume/pdf/route");
    const body = buildResumePdfUnavailableBody();
    assert.equal(typeof body.error, "string");
    assert.equal(Object.keys(body).sort().join(","), "error");
    const src = readFileSync(path.join(process.cwd(), "src/app/api/resume/pdf/route.ts"), "utf8");
    assert.doesNotMatch(src, /\bdetail\s*:/);
  });
});

describe("POST /api/contact — HTTP status on failure", () => {
  it("returns 400 for invalid JSON", async () => {
    const res = await contactPost(
      new Request("http://x/api/contact", { method: "POST", body: "not-json" }),
    );
    assert.equal(res.status, 400);
  });

  it("returns 400 for validation failure when Turnstile is not configured", async () => {
    const res = await contactPost(
      new Request("http://x/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "not-an-email",
          message: "hello",
          honeypot: "",
          path: "/contact",
        }),
      }),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /email/i);
  });

  it("returns 400 for missing message without touching Firestore", async () => {
    const res = await contactPost(
      new Request("http://x/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "ada@example.com",
          message: "",
          honeypot: "",
          path: "/contact",
        }),
      }),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.ok(body.error);
  });
});

describe("jobs typeahead — 429 Retry-After and rate_limited flag", () => {
  beforeEach(() => {
    clearRateLimitStateForTests();
  });

  it("typeaheadRetryAfterHeader uses whole seconds from the window", () => {
    assert.deepEqual(typeaheadRetryAfterHeader(JOBS_SUGGEST_WINDOW_MS), { "Retry-After": "60" });
    assert.deepEqual(typeaheadRetryAfterHeader(JOBS_LOCATION_WINDOW_MS), { "Retry-After": "60" });
  });

  it("GET /api/jobs/suggest returns 429 with empty shape + rate_limited when limited", async () => {
    const ip = "203.0.113.77";
    for (let i = 0; i < JOBS_SUGGEST_MAX_REQUESTS; i++) {
      assert.equal(allowJobsSuggestRequest(ip), true);
    }
    assert.equal(allowJobsSuggestRequest(ip), false);
    const req = new Request("http://x/api/jobs/suggest?q=engineer", {
      headers: { "x-forwarded-for": ip },
    });
    const res = await suggestGet(req);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "60");
    assert.deepEqual(await res.json(), jobsSuggestRateLimitedBody());
  });

  it("GET /api/jobs/locations returns 429 with empty shape + rate_limited when limited", async () => {
    const ip = "203.0.113.88";
    for (let i = 0; i < JOBS_LOCATION_MAX_REQUESTS; i++) {
      assert.equal(allowJobsLocationRequest(ip), true);
    }
    assert.equal(allowJobsLocationRequest(ip), false);
    const req = new Request("http://x/api/jobs/locations?q=tor", {
      headers: { "x-forwarded-for": ip },
    });
    const res = await locationsGet(req);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "60");
    assert.deepEqual(await res.json(), jobsLocationRateLimitedBody());
  });
});

describe("email shell — public support contact (no postal address)", () => {
  const shell = {
    siteUrl: "https://velai.app",
    unsubscribeUrl: "https://velai.app/unsub?t=1",
    preheader: "p",
    heading: "Hi",
    bodyHtml: "<p>Body</p>",
    bodyText: "Body",
  };

  it("renders hello@thesubspace.io in HTML and plain text footers", () => {
    const html = renderEmailShellHtml({ ...shell, bodyHtml: shell.bodyHtml });
    const text = renderEmailShellText({ ...shell, bodyText: shell.bodyText });
    assert.match(html, new RegExp(PUBLIC_SUPPORT_EMAIL));
    assert.match(text, new RegExp(PUBLIC_SUPPORT_EMAIL));
    assert.doesNotMatch(html, /123 Main/);
    assert.doesNotMatch(text, /123 Main/);
  });
});

describe("jobs/[slug] — notFound on miss", () => {
  it("calls notFound() when load returns no job (page and generateMetadata)", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/jobs/[slug]/page.tsx"), "utf8");
    assert.match(src, /if \(!found\) notFound\(\)/g);
    const matches = src.match(/if \(!found\) notFound\(\)/g);
    assert.ok(matches && matches.length >= 2, "expected notFound in generateMetadata and page");
  });
});

describe("telemetry ingest — unknown event names", () => {
  const NOW = Date.parse("2026-09-03T12:00:00Z");

  it("drops unknown_event_name but keeps a known analytics wire name", () => {
    const goodId = "11111111-1111-4111-8111-111111111111";
    const badId = "22222222-2222-4222-8222-222222222222";
    const { rows, rejections } = processBatch(
      [
        {
          event_id: goodId,
          occurred_at: new Date(NOW).toISOString(),
          session_id: "33333333-3333-4333-8333-333333333333",
          event_name: "job_viewed",
        },
        {
          event_id: badId,
          occurred_at: new Date(NOW).toISOString(),
          session_id: "44444444-4444-4444-8444-444444444444",
          event_name: "totally_unknown_signal",
        },
      ],
      NOW,
    );
    assert.deepEqual(rows.map((r) => r.event_id), [goodId]);
    assert.deepEqual(rejections, [{ event_id: badId, reason: "unknown_event_name" }]);
  });
});
