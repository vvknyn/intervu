import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    deletePosthogPerson,
    deleteStripeCustomer,
    eraseAccount,
    eraseIdentityStore,
    eraseMirrorStore,
    erasePgRows,
    findStripeCustomerByUid,
    type EraseAccountDeps,
} from "../../src/lib/account/erase-account";
import { deleteLegacyFirebaseUser, hasFirebaseCredentials } from "../../src/lib/firebase/admin";
import { incompleteEraseMessage } from "../../src/lib/account/erase-copy";
import { PUBLIC_SUPPORT_EMAIL } from "../../src/lib/legal/public-contact";

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
        deleteLegacySignIn: async (uid) => (calls.push(`firebase:${uid}`), "deleted"),
        deleteSignIn: async (uid) => void calls.push(`workos:${uid}`),
        findStripeCustomerByUid: async (uid) => (calls.push(`stripe-find:${uid}`), null),
        eraseIdentityStore: async (uid, email) => (calls.push(`identity:${uid}:${email}`), "deleted"),
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
            "identity:u1:maya@example.com",
        ]);
        assert.ok(results.every((r) => r.status === "deleted"));
    });

    it("skips Stripe quietly when the profile has no customer", async () => {
        const { calls, deps } = recorder({ stripeCustomerId: async () => null });
        const results = await eraseAccount({ uid: "u2", email: null }, deps);
        assert.ok(calls.includes("stripe-find:u2"));
        assert.ok(!calls.some((c) => c.startsWith("stripe:") || c.startsWith("log:")));
        assert.deepEqual(results.find((r) => r.processor === "stripe"), { processor: "stripe", status: "not-applicable" });
        assert.equal(calls.at(-1), "identity:u2:null");
    });

    it("finds the Stripe customer at Stripe when the profile read fails or has none, else reports failed", async () => {
        for (const profile of [async () => null, async () => { throw new Error("profile gone"); }]) {
            const { calls, deps } = recorder({ stripeCustomerId: profile, findStripeCustomerByUid: async () => "cus_found" });
            const results = await eraseAccount({ uid: "u1", email: null }, deps);
            assert.ok(calls.includes("stripe:cus_found"));
            assert.equal(results.find((r) => r.processor === "stripe")?.status, "deleted");
        }
        const { calls, deps } = recorder({
            stripeCustomerId: async () => null,
            findStripeCustomerByUid: async () => { throw new Error("stripe 500"); },
        });
        const results = await eraseAccount({ uid: "u1", email: null }, deps);
        assert.equal(results.find((r) => r.processor === "stripe")?.status, "failed");
        assert.ok(calls.some((c) => c.startsWith("log:[erase] processor=stripe status=failed") && c.includes("stripe 500")));
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
        assert.ok(calls.includes("workos:u3"));
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

    it("a failing step is reported, never thrown, and every later step still runs", async () => {
        for (const broken of ["deletePaths", "deleteSignIn", "eraseIdentityStore"] as const) {
            const { calls, deps } = recorder({ [broken]: async () => { throw new Error("db down"); } });
            const results = await eraseAccount({ uid: "u4", email: "maya@example.com" }, deps);
            assert.equal(results.filter((r) => r.status === "failed").length, 1, broken);
            assert.ok(calls.includes("identity:u4:maya@example.com") || broken === "eraseIdentityStore", broken);
            assert.ok(calls.includes("workos:u4") || broken === "deleteSignIn", broken);
        }
    });
});

describe("eraseIdentityStore", () => {
    const pg = {} as never;
    it("deletes by address and by uid, and reports not-found when neither row existed", async () => {
        const seen: string[] = [];
        const forget = async (_p: unknown, _c: unknown, email: string) => (seen.push(`email:${email}`), true);
        const byUid = async (_q: unknown, uid: string) => (seen.push(`uid:${uid}`), 0);
        assert.equal(await eraseIdentityStore(pg, "u1", "a@b.co", forget as never, byUid as never), "deleted");
        assert.deepEqual(seen, ["email:a@b.co", "uid:u1"]);
        assert.equal(await eraseIdentityStore(pg, "u1", "a@b.co", (async () => false) as never, (async () => 0) as never), "not-found");
    });
    it("a username account (no email) still erases by uid; no database is not-configured", async () => {
        assert.equal(await eraseIdentityStore(pg, "u9", null, (async () => { throw new Error("no email"); }) as never, (async () => 1) as never), "deleted");
        assert.equal(await eraseIdentityStore(null, "u9", null, (async () => false) as never, (async () => 1) as never), "not-configured");
    });
});

describe("findStripeCustomerByUid", () => {
    const stripe = (data: unknown[], customers: unknown[] = []) => {
        const queries: string[] = [];
        const search = (rows: unknown[]) => async ({ query }: { query: string }) => (queries.push(query), { data: rows });
        return { queries, client: { subscriptions: { search: search(data) }, customers: { search: search(customers) } } as never };
    };
    it("returns the customer of the subscription stamped with the uid, string or expanded", async () => {
        const a = stripe([{ customer: "cus_1" }]);
        assert.equal(await findStripeCustomerByUid("u1", a.client), "cus_1");
        assert.ok(a.queries[0].includes("u1"));
        assert.equal(await findStripeCustomerByUid("u1", stripe([{ customer: { id: "cus_2" } }]).client), "cus_2");
    });
    it("finds a prepaid buyer's customer (no subscription) by the uid on the customer", async () => {
        const c = stripe([], [{ id: "cus_prepaid" }]);
        assert.equal(await findStripeCustomerByUid("u1", c.client), "cus_prepaid");
        assert.equal(c.queries.length, 2);
        assert.ok(c.queries.every((q) => q.includes("metadata['velai_uid']:'u1'")));
        assert.equal(await findStripeCustomerByUid("u1", stripe([{ customer: "cus_sub" }], [{ id: "cus_other" }]).client), "cus_sub");
    });
    it("is null without billing, without a match, and for a uid that is not a plain id", async () => {
        assert.equal(await findStripeCustomerByUid("u1", null), null);
        assert.equal(await findStripeCustomerByUid("u1", stripe([]).client), null);
        const q = stripe([{ customer: "cus_x" }]);
        assert.equal(await findStripeCustomerByUid("u1' OR 'x'='x", q.client), null);
        assert.equal(q.queries.length, 0);
    });
});

describe("incompleteEraseMessage", () => {
    it("names each unerased processor once, in plain words, with the support address", () => {
        const one = incompleteEraseMessage(["stripe"]);
        assert.match(one, /Stripe/);
        assert.ok(one.includes(PUBLIC_SUPPORT_EMAIL));
        assert.match(one, /remove it by hand/);
        const many = incompleteEraseMessage(["stripe", "stripe", "identity-store", "sign-in"]);
        assert.equal(many.match(/Stripe/g)?.length, 1);
        assert.match(many, /email alert records/);
        assert.match(many, /sign-in record/);
        assert.match(many, /remove them by hand/);
        assert.doesNotMatch(many, /identity-store|undefined/);
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

    it("throws on a non-ok, non-404 delete, and tolerates a 404", async () => {
        const reply = (status: number) => async (_url: string, init?: { method?: string }) =>
            init?.method === "DELETE"
                ? { ok: status < 300, status, json: async () => ({}) }
                : { ok: true, status: 200, json: async () => ({ results: [{ id: "p-1", distinct_ids: ["u1"] }] }) };
        await assert.rejects(deletePosthogPerson("u1", env, reply(500)), /500/);
        await assert.rejects(deletePosthogPerson("u1", env, reply(403)), /403/);
        assert.equal(await deletePosthogPerson("u1", env, reply(404)), "deleted");
        const lookupDown = async () => ({ ok: false, status: 502, json: async () => ({}) });
        await assert.rejects(deletePosthogPerson("u1", env, lookupDown), /502/);
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
            for (const step of ["stripe:cus_1", "firebase:u1", "workos:u1", "identity:u1:maya@example.com"]) assert.ok(calls.includes(step), `${broken}: ${step}`);
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
    const store = (owned: string[], deleted: string[][] = []) => () => ({ ownedPaths: async () => [...owned], emailPaths: async () => ["c/9", "a/1"], deletePaths: async (p: string[]) => void deleted.push(p), stripeCustomerId: async () => null });

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
    it("calls deletePaths with the collected, de-duplicated paths (owned plus email-keyed)", async () => {
        const deleted: string[][] = [];
        await withEnv({ DATA_STORE: "postgres", FIREBASE_CLIENT_EMAIL: "x", FIREBASE_PRIVATE_KEY: "y" }, async () => {
            await eraseMirrorStore("u1", "m@example.com", open(), store(["a/1", "b/2"], deleted));
            await eraseMirrorStore("u1", null, open(), store(["a/1", "b/2"], deleted));
        });
        assert.deepEqual(deleted, [["a/1", "b/2", "c/9"], ["a/1", "b/2"]]);
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

describe("missing credentials give a status, never a throw", () => {
    it("deleteLegacyFirebaseUser without Firebase credentials is not-configured", async () => {
        assert.equal(await deleteLegacyFirebaseUser("u1", false), "not-configured");
    });

    it("hasFirebaseCredentials accepts the service-account key or the email+key pair, and nothing less", () => {
        assert.equal(hasFirebaseCredentials({}), false);
        assert.equal(hasFirebaseCredentials({ FIREBASE_CLIENT_EMAIL: "a@b.iam" }), false);
        assert.equal(hasFirebaseCredentials({ FIREBASE_PRIVATE_KEY: "k" }), false);
        assert.equal(hasFirebaseCredentials({ FIREBASE_SERVICE_ACCOUNT_KEY: "  " }), false);
        assert.equal(hasFirebaseCredentials({ FIREBASE_SERVICE_ACCOUNT_KEY: "{}" }), true);
        assert.equal(hasFirebaseCredentials({ FIREBASE_CLIENT_EMAIL: "a@b.iam", FIREBASE_PRIVATE_KEY: "k" }), true);
    });

    it("every credential-dependent dependency answering not-configured is reported by name, and the run completes", async () => {
        const nc = async () => "not-configured" as const;
        const { calls, deps } = recorder({
            deleteStripeCustomer: nc,
            eraseMirrorStore: nc,
            deleteAnalyticsPerson: nc,
            deleteLegacySignIn: nc,
        });
        const results = await eraseAccount({ uid: "u9", email: null }, deps);
        assert.deepEqual(
            results.filter((r) => r.status === "not-configured").map((r) => r.processor),
            ["stripe", "mirror-store", "posthog", "firebase-auth"],
        );
        assert.ok(calls.includes("workos:u9"));
    });
});
