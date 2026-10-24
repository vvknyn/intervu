import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RECOMPUTE_EVENT_TYPES } from "../../src/lib/billing/events";

describe("docs/billing.md", () => {
    const doc = readFileSync("docs/billing.md", "utf8");
    const line = doc.split("\n").find((l) => l.includes("Webhook endpoint")) ?? "";
    const listed = [...line.matchAll(/`((?:checkout|charge)\.[a-z_.]+)`/g)].map((m) => m[1]);
    it("lists exactly the webhook events the handler acts on", () => {
        assert.deepEqual([...listed].sort(), [...RECOMPUTE_EVENT_TYPES].sort());
    });
    it("documents the real data model and the retention secret", () => {
        assert.ok(doc.includes("access_until") && doc.includes("grants[]"));
        assert.ok(!/paid_until|granted_until/.test(doc));
        assert.ok(doc.includes("RESUME_RETENTION_CRON_SECRET"));
    });
});
