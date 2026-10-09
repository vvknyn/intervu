/**
 * The Firestore exit's copy and check (scripts/lib/firestore-exit.ts)
 * against a real Postgres and a stand-in Firestore. Skipped unless
 * DOCSTORE_TEST_PG_URL names a scratch database with
 * deploy/db-box/intervu-schema.sql applied (see docstore-pg.test.ts). It
 * empties every intervu table, so never point it at a real one.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { Pool } from "pg";

import { createPgDocDb, type Engine, type PgDocDb } from "../../src/lib/db/docstore/pg-docstore";
import { deriveDocKeys } from "../../src/lib/db/docstore/seal";
import { checkTables, copyAll, inventoryFirestore } from "../../scripts/lib/firestore-exit";

const URL = process.env.DOCSTORE_TEST_PG_URL;

/** Just enough of Firestore's admin API for inventoryFirestore(). */
function fakeFirestore(docs: Record<string, Record<string, unknown>>): Firestore {
    const snap = (path: string) => ({ ref: { path }, exists: path in docs, data: () => docs[path] });
    const under = (prefix: string) =>
        Object.keys(docs).filter((p) => p.startsWith(`${prefix}/`) && p.split("/").length === prefix.split("/").length + 1);
    const collection = (path: string) => ({
        id: path.split("/").pop(),
        path,
        get: async () => {
            const hits = under(path).map(snap);
            return { docs: hits, size: hits.length };
        },
        listDocuments: async () => {
            const ids = new Set(Object.keys(docs).filter((p) => p.startsWith(`${path}/`)).map((p) => p.split("/").slice(0, path.split("/").length + 1).join("/")));
            return [...ids].map((docPath) => ({
                path: docPath,
                get: async () => snap(docPath),
                listCollections: async () => {
                    const subs = new Set(Object.keys(docs).filter((p) => p.startsWith(`${docPath}/`)).map((p) => p.split("/")[docPath.split("/").length]));
                    return [...subs].map((id) => collection(`${docPath}/${id}`));
                },
            }));
        },
    });
    return {
        collection,
        collectionGroup: (id: string) => ({
            get: async () => {
                const hits = Object.keys(docs).filter((p) => { const s = p.split("/"); return s.length > 2 && s[s.length - 2] === id; }).map(snap);
                return { docs: hits, size: hits.length };
            },
        }),
        listCollections: async () => [...new Set(Object.keys(docs).map((p) => p.split("/")[0]))].map((id) => collection(id)),
    } as unknown as Firestore;
}

describe("firestore exit copy", { skip: !URL && "DOCSTORE_TEST_PG_URL not set" }, () => {
    let pool: Pool;
    let db: PgDocDb;
    let engine: Engine;
    const logs: string[] = [];
    const log = (l: string) => logs.push(l);

    before(async () => {
        pool = new Pool({ connectionString: URL, max: 4 });
        db = createPgDocDb(pool, deriveDocKeys("ef".repeat(32)));
        engine = db.engine;
        const { rows } = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'intervu'`);
        for (const r of rows) await pool.query(`DELETE FROM intervu."${r.tablename}"`);
        process.env.AGENT_PG_LIVE_COLLECTIONS = "agent_credentials";
    });
    after(async () => {
        delete process.env.AGENT_PG_LIVE_COLLECTIONS;
        await pool.end();
    });

    const firestore = fakeFirestore({
        "profiles/u1": { username: "maya", resume_text: "Maya Okonkwo, RN" },
        "profiles/u1/resume_history/h1": { content: "old résumé", saved_at: "2026-10-01" },
        "users/u1/savedSearches/s1": { q: "nurse" },
        "users/u1/oldThing/x": { note: "forgotten subcollection" },
        "applications/a1": { user_id: "u1", status: "applied", applied_resume: { content: "Maya" } },
        "email_suppressions/maya@example.com": { entries: { digest: "2026-10-01" } },
        "agent_credentials/stale": { uid: "u1", tokenHash: "old" },
        "mystery_collection/m1": { anything: "kept" },
    });

    it("copies everything sealed, prunes the old plain copy and matches Firestore", async () => {
        // The old one-off plain copy: a since-deleted application, and a
        // suppression stored at its readable email path.
        await pool.query(`INSERT INTO intervu.applications (path, doc) VALUES ('applications/deleted', '{"user_id":"u1","company_name":"Old Co"}')`);
        await pool.query(`INSERT INTO intervu.email_suppressions (path, doc) VALUES ('email_suppressions/maya@example.com', '{"entries":{}}')`);
        // Agent credentials already live on Postgres (plain), newer than Firestore.
        await pool.query(`INSERT INTO intervu.agent_credentials (path, doc) VALUES ('agent_credentials/live', '{"uid":"u1","tokenHash":"new","expiresAt":1,"revokedAt":null,"clientId":"c"}')`);

        const inv = await inventoryFirestore(firestore, log);
        assert.deepEqual(inv.legacy.map((d) => d.path).sort(), ["mystery_collection/m1", "users/u1/oldThing/x"]);

        // Before the switch the app still reads agent rows unsealed, so the
        // first pass leaves them alone and the check doesn't count that as a gap.
        await copyAll(engine, pool, inv, null, log, false);
        const before = await pool.query(`SELECT doc->>'clientId' AS c, sealed FROM intervu.agent_credentials WHERE path = 'agent_credentials/live'`);
        assert.deepEqual(before.rows[0], { c: "c", sealed: null });
        assert.deepEqual((await checkTables(engine, pool, inv, false)).filter((c) => c.missing.length || (c.unsealed && !c.unsealedOk)), []);

        await copyAll(engine, pool, inv, null, log, true);
        const checks = await checkTables(engine, pool, inv, true);
        const bad = checks.filter((c) => c.missing.length || c.unsealed);
        assert.deepEqual(bad, [], JSON.stringify(bad));

        const plain = await pool.query(`SELECT count(*)::int AS n FROM intervu.applications WHERE path = 'applications/deleted'`);
        assert.equal(plain.rows[0].n, 0, "since-deleted row pruned");
        const emailPaths = await pool.query(`SELECT path FROM intervu.email_suppressions`);
        assert.ok(emailPaths.rows.every((r) => !String(r.path).includes("@")));
        const cred = await db.collection("agent_credentials").doc("live").get();
        assert.equal(cred.get("tokenHash"), "new", "Postgres-live rows resealed, not replaced from Firestore");
        assert.equal((await db.collection("agent_credentials").doc("stale").get()).exists, false);
        assert.equal((await db.collection("profiles").doc("u1").get()).get("resume_text"), "Maya Okonkwo, RN");
        const leaks = await pool.query(
            `SELECT count(*)::int AS n FROM intervu.profiles WHERE doc::text LIKE '%Maya%' OR sealed IS NULL`,
        );
        assert.equal(leaks.rows[0].n, 0);
    });

    it("the second pass never overwrites what the app wrote after the switch", async () => {
        const flippedAt = new Date();
        await new Promise((r) => setTimeout(r, 20));
        await db.collection("profiles").doc("u1").set({ username: "maya", resume_text: "edited after the switch" });
        await db.collection("applications").doc("new-after-flip").set({ user_id: "u1", status: "interested" });
        await copyAll(engine, pool, await inventoryFirestore(firestore, log), flippedAt, log);
        assert.equal((await db.collection("profiles").doc("u1").get()).get("resume_text"), "edited after the switch");
        assert.equal((await db.collection("applications").doc("new-after-flip").get()).exists, true);
    });

    it("never reads a left-behind collection from Firestore, and keeps and reseals its Postgres rows", async () => {
        process.env.FIRESTORE_EXIT_SKIP = "search_events";
        try {
            const withLogs = fakeFirestore({ "profiles/u1": { username: "maya" }, "search_events/e1": { q: "nurse" } });
            const real = withLogs.collection.bind(withLogs);
            (withLogs as unknown as { collection: (p: string) => unknown }).collection = (path: string) => {
                if (path === "search_events") throw new Error("read a left-behind collection");
                return real(path);
            };
            await pool.query(`INSERT INTO intervu.search_events (path, doc) VALUES ('search_events/old', '{"q":"welder","expiresAt":"2026-12-01T00:00:00.000Z"}')`);

            const inv = await inventoryFirestore(withLogs, log);
            assert.deepEqual(inv.known.get("search_events"), []);

            await copyAll(engine, pool, inv, null, log, false);
            const kept = await pool.query(`SELECT sealed FROM intervu.search_events WHERE path = 'search_events/old'`);
            assert.deepEqual(kept.rows, [{ sealed: null }], "kept, not pruned, before the switch");
            assert.deepEqual((await checkTables(engine, pool, inv, false)).filter((c) => c.missing.length || (c.unsealed && !c.unsealedOk)), []);

            await copyAll(engine, pool, inv, null, log, true);
            assert.equal((await db.collection("search_events").doc("old").get()).get("q"), "welder");
            const plain = await pool.query(`SELECT count(*)::int AS n FROM intervu.search_events WHERE sealed IS NULL OR doc::text LIKE '%welder%'`);
            assert.equal(plain.rows[0].n, 0, "resealed after the switch");
            assert.deepEqual((await checkTables(engine, pool, inv, true)).filter((c) => c.missing.length || c.unsealed), []);
        } finally {
            delete process.env.FIRESTORE_EXIT_SKIP;
        }
    });
});
