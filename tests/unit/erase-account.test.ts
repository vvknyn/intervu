import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    deletePosthogPerson,
    deleteStripeCustomer,
    eraseAccount,
    eraseMirrorStore,
    erasePgRows,
    type EraseAccountDeps,
} from "../../src/lib/account/erase-account";

function recorder(overrides: Partial<EraseAccountDeps> = {}) {
    const calls: string[] = [];
    const deps: EraseAccountDeps = {
        ownedPaths: async (uid) => (calls.push(`owned:${uid}`), ["profiles/u1", "applications/a1"]),
        emailPaths: async (email) => (calls.push(`email:${email}`), ["contact_messages/c1", "applications/a1"]),
        deletePaths: async (paths) => void calls.push(`delete:${paths.join(",")}`),
        stripeCustomerId: async (uid) => (calls.push(`stripe-id:${uid}`), "cus_1"),
        deleteStripeCustomer: async (id) => (calls.push(`stripe:${id}`), "deleted"),
        eraseMirrorStore: async (uid) => (calls.push(`mirror:${uid}`), "deleted"),
        deletePgRows: async (uid) => (calls.push(`pg:${uid}`), "deleted"),
        deleteTelemetry: async (uid) => (calls.push(`telemetry:${uid}`), "deleted"),
        deleteAnalyticsPerson: async (uid) => (calls.push(`posthog:${uid}`), "deleted"),
        deleteLegacySignIn: async (uid) => (calls.push(`firebase:${uid}`), true),
        deleteSignIn: async (uid) => void calls.push(`workos:${uid}`),
        forgetEmail: async (email) => void calls.push(`forget:${email}`),
        logError: (message) => void calls.push(`log:${message}`),
        ...overrides,
    };
    return { calls, deps };
}

describe("eraseAccount", () => {
    it("reads the Stripe id before the profile goes, erases every store and processor, then the sign-in record", async () => {
        const { calls, deps } = recorder();
        const results = await eraseAccount({ uid: "u1", email: "maya@example.com" }, deps);
        assert.deepEqual(calls, [
            "stripe-id:u1",
            "owned:u1",
            "email:maya@example.com",
            "delete:profiles/u1,applications/a1,contact_messages/c1",
            "pg:u1",
            "telemetry:u1",
            "stripe:cus_1",
            "mirror:u1",
            "posthog:u1",
            "firebase:u1",
            "workos:u1",
            "forget:maya@example.com",
        ]);
        assert.ok(results.every((r) => r.status === "deleted"));
    });

    it("skips Stripe quietly when the profile has no customer", async () => {
        const { calls, deps } = recorder({ stripeCustomerId: async () => null });
        const results = await eraseAccount({ uid: "u2", email: null }, deps);
        assert.ok(!calls.some((c) => c.startsWith("stripe:") || c.startsWith("log:")));
        assert.deepEqual(results.find((r) => r.processor === "stripe"), { processor: "stripe", status: "not-applicable" });
        assert.equal(calls.at(-1), "workos:u2");
    });

    it("reports Stripe as not-configured when a customer exists but billing is off", async () => {
        const { calls, deps } = recorder({ deleteStripeCustomer: async () => "not-configured" });
        const results = await eraseAccount({ uid: "u1", email: null }, deps);
        assert.ok(calls.includes("log:[erase] processor=stripe status=not-configured customer=cus_1"));
        assert.deepEqual(results.find((r) => r.processor === "stripe"), { processor: "stripe", status: "not-configured" });
    });

    it("reports every unreachable processor, names it in the log, and still removes the sign-in record", async () => {
        const down = async () => {
            throw new Error("503");
        };
        const { calls, deps } = recorder({
            deleteStripeCustomer: down,
            eraseMirrorStore: down,
            deleteAnalyticsPerson: async () => "not-configured",
            deleteLegacySignIn: down,
        });
        const results = await eraseAccount({ uid: "u3", email: null }, deps);
        assert.ok(calls.includes("log:[erase] processor=stripe status=failed customer=cus_1 reason=503"));
        assert.ok(calls.includes("log:[erase] processor=mirror-store status=failed reason=503"));
        assert.ok(calls.includes("log:[erase] processor=posthog status=not-configured"));
        assert.ok(calls.includes("log:[erase] processor=firebase-auth status=failed reason=503"));
        assert.deepEqual(
            results.filter((r) => r.status !== "deleted").map((r) => r.processor),
            ["stripe", "mirror-store", "posthog", "firebase-auth"],
        );
        assert.equal(calls.at(-1), "workos:u3");
    });

    it("reports unconfigured Postgres and telemetry stores", async () => {
        const { calls, deps } = recorder({
            deletePgRows: async () => "not-configured",
            deleteTelemetry: async () => "not-configured",
        });
        await eraseAccount({ uid: "u5", email: null }, deps);
        assert.ok(calls.includes("log:[erase] processor=pg-rows status=not-configured"));
        assert.ok(calls.includes("log:[erase] processor=telemetry status=not-configured"));
    });

    it("keeps the sign-in record when a store step fails, so the person can retry", async () => {
        const { calls, deps } = recorder({
            deletePaths: async () => {
                throw new Error("db down");
            },
        });
        await assert.rejects(eraseAccount({ uid: "u4", email: null }, deps));
        assert.ok(!calls.some((c) => c.startsWith("workos:")));
    });
});

describe("deleteStripeCustomer", () => {
    const fake = (del: (id: string) => Promise<unknown>) => ({ customers: { del } }) as never;

    it("deletes the customer", async () => {
        const seen: string[] = [];
        assert.equal(await deleteStripeCustomer("cus_9", fake(async (id) => void seen.push(id))), "deleted");
        assert.deepEqual(seen, ["cus_9"]);
    });

    it("is not-configured without a Stripe client", async () => {
        assert.equal(await deleteStripeCustomer("cus_9", null), "not-configured");
    });

    it("treats an already-missing customer as not-found and rethrows anything else", async () => {
        const missing = fake(async () => Promise.reject(Object.assign(new Error("gone"), { code: "resource_missing" })));
        assert.equal(await deleteStripeCustomer("cus_9", missing), "not-found");
        await assert.rejects(deleteStripeCustomer("cus_9", fake(async () => Promise.reject(new Error("500")))));
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

describe("eraseAccount isolation", () => {
    it("one processor throwing never skips the rest, whichever it is", async () => {
        for (const broken of ["deletePgRows", "deleteTelemetry", "eraseMirrorStore", "deleteAnalyticsPerson"] as const) {
            const { calls, deps } = recorder({ [broken]: async () => { throw new Error("blip"); } });
            const results = await eraseAccount({ uid: "u1", email: "maya@example.com" }, deps);
            assert.equal(results.filter((r) => r.status === "failed").length, 1, broken);
            for (const step of ["stripe:cus_1", "firebase:u1", "workos:u1", "forget:maya@example.com"]) assert.ok(calls.includes(step), `${broken}: ${step}`);
        }
    });
});

describe("eraseMirrorStore", () => {
    const FIREBASE_ENV = ["DATA_STORE", "DATA_PG_URL", "FIREBASE_SERVICE_ACCOUNT_KEY", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"] as const;
    async function withEnv<T>(env: Partial<Record<(typeof FIREBASE_ENV)[number], string>>, fn: () => Promise<T>): Promise<T> {
        const saved = FIREBASE_ENV.map((k) => [k, process.env[k]] as const);
        for (const k of FIREBASE_ENV) delete process.env[k];
        Object.assign(process.env, env);
        try {
            return await fn();
        } finally {
            for (const [k, v] of saved) v === undefined ? delete process.env[k] : (process.env[k] = v);
        }
    }
    const open = () => ({ firestore: () => ({}) as never, postgres: () => ({}) as never });
    const store = (owned: string[]) => () => ({ ownedPaths: async () => [...owned], emailPaths: async () => [], deletePaths: async () => {}, stripeCustomerId: async () => null });

    it("is not-configured, not failed, when the postgres primary has no Firebase credentials", async () => {
        await withEnv({ DATA_STORE: "postgres" }, async () => {
            assert.equal(await eraseMirrorStore("u1", null, open(), store(["a/1"])), "not-configured");
        });
    });
    it("reports deleted for docs removed and not-found for none", async () => {
        const env = { DATA_STORE: "postgres", FIREBASE_CLIENT_EMAIL: "x", FIREBASE_PRIVATE_KEY: "y" };
        await withEnv(env, async () => {
            assert.equal(await eraseMirrorStore("u1", null, open(), store(["a/1"])), "deleted");
            assert.equal(await eraseMirrorStore("u1", null, open(), store([])), "not-found");
        });
    });
    it("is not-applicable on a firestore primary with no postgres copy", async () => {
        await withEnv({}, async () => {
            assert.equal(await eraseMirrorStore("u1", null, open(), store(["a/1"])), "not-applicable");
        });
    });
});

describe("erasePgRows / deletePgUserRows", () => {
    const pgWith = (rowsPerTable: number[]) => {
        const seen: string[] = [];
        let i = 0;
        return { seen, q: { query: async (sql: string) => (seen.push(sql), { rows: Array.from({ length: rowsPerTable[i++] ?? 0 }, () => ({ "?column?": 1 })) }) } as never };
    };
    it("deletes from every uid-keyed table and reports from the real counts", async () => {
        const { seen, q } = pgWith([0, 2]);
        assert.equal(await erasePgRows(q, "u1"), "deleted");
        assert.equal(seen.length, 2);
        assert.ok(seen.every((sql) => sql.startsWith("DELETE FROM intervu.")));
        assert.equal(await erasePgRows(pgWith([0, 0]).q, "u1"), "not-found");
    });
    it("is not-configured without a database", async () => {
        assert.equal(await erasePgRows(null, "u1"), "not-configured");
    });
});
