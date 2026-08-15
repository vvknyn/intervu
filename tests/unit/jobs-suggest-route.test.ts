/**
 * GET /api/jobs/suggest (2026-08-14) replaces the deleted `suggestJobsAction`
 * server action — a route handler so the typeahead has its own connection
 * instead of queuing behind an in-flight `searchJobsAction` call (server
 * actions serialize per client).
 *
 * `resolveSuggestQuery` is pinned directly (pure — no HTTP mocking needed).
 * The rate-limit branch is covered separately in shield-rate-limit.test.ts
 * (`allowJobsSuggestRequest`) — its own per-chokepoint store, same pattern
 * as search's and the connect-waitlist's. `GET` itself is only exercised for
 * the empty-q short-circuit here: any non-empty q reaches `getClientIp()`,
 * which calls next/headers's `headers()` and throws outside a real request
 * scope — exactly the class of coupling the pure-helper extraction avoids.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET, resolveSuggestQuery } from "../../src/app/api/jobs/suggest/route";

describe("resolveSuggestQuery — pure q parsing/capping", () => {
    it("trims surrounding whitespace", () => {
        assert.equal(resolveSuggestQuery("  engineer  "), "engineer");
    });

    it("returns an empty string for null or whitespace-only input", () => {
        assert.equal(resolveSuggestQuery(null), "");
        assert.equal(resolveSuggestQuery("   "), "");
    });

    it("caps at 200 chars — same posture the deleted suggestJobsAction carried", () => {
        const long = "a".repeat(250);
        const result = resolveSuggestQuery(long);
        assert.equal(result.length, 200);
        assert.equal(result, "a".repeat(200));
    });

    it("caps AFTER trimming — surrounding whitespace doesn't eat into the 200-char budget", () => {
        const long = `  ${"a".repeat(200)}  `;
        assert.equal(resolveSuggestQuery(long), "a".repeat(200));
    });
});

describe("GET /api/jobs/suggest — empty-query short-circuit", () => {
    it("returns empty suggestions for a whitespace-only q, without reaching the rate limiter or backend", async () => {
        const res = await GET(new Request("http://x/api/jobs/suggest?q=%20%20"));
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { titles: [], companies: [] });
    });

    it("returns empty suggestions when q is absent entirely", async () => {
        const res = await GET(new Request("http://x/api/jobs/suggest"));
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { titles: [], companies: [] });
    });
});
