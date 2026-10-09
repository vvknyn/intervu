import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deletePosthogPerson, eraseAccount, type EraseAccountDeps } from "../../src/lib/account/erase-account";

function recorder(overrides: Partial<EraseAccountDeps> = {}) {
    const calls: string[] = [];
    const deps: EraseAccountDeps = {
        ownedPaths: async (uid) => (calls.push(`owned:${uid}`), ["profiles/u1", "applications/a1"]),
        emailPaths: async (email) => (calls.push(`email:${email}`), ["contact_messages/c1", "applications/a1"]),
        deletePaths: async (paths) => void calls.push(`delete:${paths.join(",")}`),
        deleteTelemetry: async (uid) => calls.push(`telemetry:${uid}`),
        deleteAnalyticsPerson: async (uid) => calls.push(`posthog:${uid}`),
        deleteSignIn: async (uid) => void calls.push(`workos:${uid}`),
        forgetEmail: async (email) => void calls.push(`forget:${email}`),
        logError: (message) => void calls.push(`log:${message}`),
        ...overrides,
    };
    return { calls, deps };
}

describe("eraseAccount", () => {
    it("erases records, ledger rows and PostHog before the sign-in record, then forgets the email", async () => {
        const { calls, deps } = recorder();
        await eraseAccount({ uid: "u1", email: "maya@example.com" }, deps);
        assert.deepEqual(calls, [
            "owned:u1",
            "email:maya@example.com",
            "delete:profiles/u1,applications/a1,contact_messages/c1",
            "telemetry:u1",
            "posthog:u1",
            "workos:u1",
            "forget:maya@example.com",
        ]);
    });

    it("still erases ledger rows and PostHog for a username-only account", async () => {
        const { calls, deps } = recorder();
        await eraseAccount({ uid: "u2", email: null }, deps);
        assert.deepEqual(calls, ["owned:u2", "delete:profiles/u1,applications/a1", "telemetry:u2", "posthog:u2", "workos:u2"]);
    });

    it("finishes the deletion when PostHog is down, and logs it", async () => {
        const { calls, deps } = recorder({
            deleteAnalyticsPerson: async () => {
                throw new Error("503");
            },
        });
        await eraseAccount({ uid: "u3", email: null }, deps);
        assert.ok(calls.includes("log:[Auth] PostHog person delete failed"));
        assert.equal(calls.at(-1), "workos:u3");
    });

    it("keeps the sign-in record when a store step fails, so the person can retry", async () => {
        const { calls, deps } = recorder({
            deleteTelemetry: async () => {
                throw new Error("db down");
            },
        });
        await assert.rejects(eraseAccount({ uid: "u4", email: null }, deps));
        assert.ok(!calls.some((c) => c.startsWith("workos:")));
    });
});

describe("deletePosthogPerson", () => {
    const env = { POSTHOG_PERSONAL_API_KEY: "phx_test", POSTHOG_PROJECT_ID: "42" };

    function fakeFetch(results: unknown[]) {
        const seen: { url: string; method: string }[] = [];
        const impl = async (url: string, init?: { method?: string }) => {
            seen.push({ url, method: init?.method ?? "GET" });
            return { ok: true, status: 200, json: async () => ({ results }) };
        };
        return { seen, impl };
    }

    it("does nothing without a personal API key", async () => {
        const { seen, impl } = fakeFetch([]);
        assert.equal(await deletePosthogPerson("u1", {}, impl), "not-configured");
        assert.equal(seen.length, 0);
    });

    it("deletes the person with their events and recordings", async () => {
        const { seen, impl } = fakeFetch([{ id: "p-1", distinct_ids: ["anon-9", "u1"] }]);
        assert.equal(await deletePosthogPerson("u1", env, impl), "deleted");
        assert.deepEqual(seen, [
            { url: "https://us.posthog.com/api/projects/42/persons/?distinct_id=u1", method: "GET" },
            { url: "https://us.posthog.com/api/projects/42/persons/p-1/?delete_events=true&delete_recordings=true", method: "DELETE" },
        ]);
    });

    it("never deletes a person who doesn't carry this distinct id", async () => {
        const { seen, impl } = fakeFetch([
            { id: "p-2", distinct_ids: ["someone-else"] },
            { id: "p-3", distinct_ids: ["u10"] },
        ]);
        assert.equal(await deletePosthogPerson("u1", env, impl), "not-found");
        assert.ok(seen.every((s) => s.method === "GET"));
    });
});
