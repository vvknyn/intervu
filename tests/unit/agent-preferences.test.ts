import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { shapeAgentPreferences, mergeAgentPreferences, type AgentPreferences } from "@/lib/agent/preferences";

describe("shapeAgentPreferences", () => {
    it("absent stored doc: configured false, empty sections, no fabricated defaults", () => {
        assert.deepEqual(shapeAgentPreferences(undefined), {
            configured: false,
            search: {},
            answers: { custom: {} },
        });
    });

    it("falsy/non-object stored values also resolve to the empty state", () => {
        assert.deepEqual(shapeAgentPreferences(null), { configured: false, search: {}, answers: { custom: {} } });
    });

    it("present stored doc: configured true, fields carried through, updated_at preserved", () => {
        const stored = {
            search: { query: "backend engineer", remoteOnly: true },
            answers: { workAuthorization: "US citizen", custom: { visa: "no sponsorship needed" } },
            updated_at: "2026-08-01T00:00:00.000Z",
        };
        const out = shapeAgentPreferences(stored);
        assert.deepEqual(out, {
            configured: true,
            search: { query: "backend engineer", remoteOnly: true },
            answers: { workAuthorization: "US citizen", custom: { visa: "no sponsorship needed" } },
            updated_at: "2026-08-01T00:00:00.000Z",
        });
    });

    it("missing custom on a stored doc defensively defaults to {} rather than throwing", () => {
        const out = shapeAgentPreferences({ answers: { workAuthorization: "US citizen" } });
        assert.equal(out.configured, true);
        assert.deepEqual(out.answers, { workAuthorization: "US citizen", custom: {} });
    });

    it("a stored doc with no search field at all still shapes cleanly", () => {
        const out = shapeAgentPreferences({ answers: { custom: {} } });
        assert.deepEqual(out.search, {});
    });
});

describe("mergeAgentPreferences", () => {
    const existing: AgentPreferences = {
        configured: true,
        search: { query: "backend engineer", location: "Remote" },
        answers: { workAuthorization: "US citizen", custom: { visa: "no sponsorship needed" } },
        updated_at: "2026-07-01T00:00:00.000Z",
    };

    it("patching ONLY search leaves answers byte-for-byte unchanged", () => {
        const out = mergeAgentPreferences(existing, { search: { location: "NYC" } });
        assert.deepEqual(out.answers, existing.answers);
    });

    it("patching ONLY answers leaves search byte-for-byte unchanged", () => {
        const out = mergeAgentPreferences(existing, { answers: { relocation: "open to relocating" } });
        assert.deepEqual(out.search, existing.search);
    });

    it("patching one search field preserves sibling fields already in existing.search", () => {
        const out = mergeAgentPreferences(existing, { search: { location: "NYC" } });
        assert.deepEqual(out.search, { query: "backend engineer", location: "NYC" });
    });

    it("patching answers.custom with one new key preserves previously-set custom keys (merge, not replace)", () => {
        const out = mergeAgentPreferences(existing, { answers: { custom: { salary_history: "not disclosed" } } });
        assert.deepEqual(out.answers.custom, {
            visa: "no sponsorship needed",
            salary_history: "not disclosed",
        });
    });

    it("an empty patch still returns configured:true and a fresh updated_at", () => {
        const out = mergeAgentPreferences(existing, {});
        assert.equal(out.configured, true);
        assert.notEqual(out.updated_at, existing.updated_at);
    });

    it("sets configured:true and a fresh ISO updated_at on an actual set", () => {
        const before = Date.now();
        const out = mergeAgentPreferences(existing, { search: { location: "NYC" } });
        assert.equal(out.configured, true);
        assert.ok(out.updated_at);
        assert.ok(new Date(out.updated_at!).getTime() >= before);
    });
});
