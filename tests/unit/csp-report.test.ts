import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCspLogBudget, formatCspLogLine, readCspReports } from "../../src/lib/security/csp-report";
import { MAX_REPORT_BYTES, POST } from "../../src/app/api/csp-report/route";

const legacy = {
  "csp-report": {
    "document-uri": "https://velai.app/jobs?q=nurse&token=secret#frag",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://cdn.example.com/lib/analytics.js?id=123",
    "source-file": "https://velai.app/_next/static/chunks/a.js",
    disposition: "report",
  },
};

const reporting = [
  {
    type: "csp-violation",
    url: "https://velai.app/pricing?utm=x",
    body: {
      documentURL: "https://velai.app/pricing?utm=x",
      effectiveDirective: "connect-src",
      blockedURL: "http://insecure.example.com/api",
      disposition: "report",
    },
  },
  { type: "deprecation", url: "https://velai.app/", body: { id: "x" } },
];

describe("readCspReports", () => {
  it("reads the legacy report-uri format and keeps only the page path and the blocked origin", () => {
    assert.deepEqual(readCspReports(legacy), [
      { directive: "script-src-elem", blocked: "https://cdn.example.com", page: "/jobs", source: "/_next/static/chunks/a.js", disposition: "report" },
    ]);
  });

  it("reads the Reporting API format and skips other report types", () => {
    assert.deepEqual(readCspReports(reporting), [
      { directive: "connect-src", blocked: "http://insecure.example.com", page: "/pricing", source: "", disposition: "report" },
    ]);
  });

  it("keeps keywords as keywords and reduces data:/blob: to their scheme", () => {
    const blocked = (b: string) => readCspReports({ "csp-report": { "document-uri": "https://velai.app/", "effective-directive": "img-src", "blocked-uri": b } })[0]?.blocked;
    assert.equal(blocked("inline"), "inline");
    assert.equal(blocked("eval"), "eval");
    assert.equal(blocked("data:image/png;base64,AAAA"), "data");
    assert.equal(blocked("blob:https://velai.app/1234"), "blob");
  });

  it("never lets a query string or fragment reach the output", () => {
    const out = JSON.stringify(readCspReports(legacy));
    assert.doesNotMatch(out, /secret|token|nurse|frag|123/);
  });

  it("yields nothing for junk", () => {
    for (const junk of [null, undefined, 5, "x", [], {}, [1, "a"], { "csp-report": 7 }, { type: "csp-violation" }, { "csp-report": {} }]) {
      assert.deepEqual(readCspReports(junk), []);
    }
  });

  it("cuts an oversized field short", () => {
    const [v] = readCspReports({ "csp-report": { "effective-directive": "x".repeat(500), "document-uri": "https://velai.app/" } });
    assert.ok(v.directive.length <= 201);
  });

  it("formats one grep-able line", () => {
    const [v] = readCspReports(legacy);
    assert.match(formatCspLogLine(v), /^\[csp-report\] \{"directive":"script-src-elem"/);
  });
});

describe("createCspLogBudget", () => {
  it("allows the budget, counts the overflow, and reports it when the window turns over", () => {
    const budget = createCspLogBudget(2, 1000);
    assert.equal(budget.take(0).allowed, true);
    assert.equal(budget.take(10).allowed, true);
    assert.equal(budget.take(20).allowed, false);
    assert.equal(budget.take(30).allowed, false);
    const next = budget.take(1500);
    assert.equal(next.allowed, true);
    assert.equal(next.droppedBefore, 2);
  });
});

describe("POST /api/csp-report", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    POST(new Request("http://x/api/csp-report", { method: "POST", body, headers: { "content-type": "application/csp-report", ...headers } }));

  it("answers 204 with no body for a report, for junk and for non-JSON", async () => {
    for (const body of [JSON.stringify(legacy), JSON.stringify(reporting), "{}", "not json", ""]) {
      const res = await post(body);
      assert.equal(res.status, 204);
      assert.equal(await res.text(), "");
    }
  });

  it("refuses a body that declares itself larger than a report can be", async () => {
    const res = await post("{}", { "content-length": String(MAX_REPORT_BYTES + 1) });
    assert.equal(res.status, 413);
  });
});
