/**
 * The sealed Postgres store against a real Postgres, driven the way app code
 * drives Firestore. Needs a scratch database with deploy/db-box/
 * intervu-schema.sql applied; skipped unless DOCSTORE_TEST_PG_URL names one:
 *
 *   DOCSTORE_TEST_PG_URL=postgres://postgres@localhost:54329/postgres \
 *     npx tsx --test tests/unit/docstore-pg.test.ts
 *
 * Every test works in its own collection paths and the suite empties the
 * tables it touched, so it can be re-run against the same database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { Pool } from "pg";

import { emailKeyedPaths } from "../../src/lib/account/erase-account";
import { createPgDocDb, type PgDocDb } from "../../src/lib/db/docstore/pg-docstore";
import { deriveDocKeys } from "../../src/lib/db/docstore/seal";

const URL = process.env.DOCSTORE_TEST_PG_URL;
const TABLES = [
    "applications", "profiles", "resume_history", "favorite_questions", "apply_counters",
    "saved_searches", "email_suppressions", "agent_codes", "search_events", "welcome_emails", "market_stats_daily",
    "contact_messages", "connect_waitlist", "founding_waitlist", "waitlist",
];

describe("pg docstore", { skip: !URL && "DOCSTORE_TEST_PG_URL not set" }, () => {
    let pool: Pool;
    let db: PgDocDb;

    before(async () => {
        pool = new Pool({ connectionString: URL, max: 8 });
        db = createPgDocDb(pool, deriveDocKeys("ab".repeat(32)));
        for (const t of TABLES) await pool.query(`DELETE FROM intervu."${t}"`);
    });
    after(async () => {
        for (const t of TABLES) await pool.query(`DELETE FROM intervu."${t}"`);
        await pool.end();
    });

    const raw = async (table: string, path: string) =>
        (await pool.query(`SELECT doc, sealed FROM intervu."${table}" WHERE path = $1`, [path])).rows[0];

    it("seals the document and keeps only lookup fields readable", async () => {
        await db.collection("applications").doc("a1").set({
            user_id: "u1",
            status: "applied",
            created_at: "2026-10-01T00:00:00.000Z",
            company_name: "Cedarbrook Health",
            applied_resume: { content: "Jordan Lee, RN" },
        });
        const row = await raw("applications", "applications/a1");
        assert.deepEqual(row.doc, { user_id: "u1", status: "applied", created_at: "2026-10-01T00:00:00.000Z" });
        assert.ok(!row.sealed.includes("Jordan") && !row.sealed.includes("Cedarbrook"));
        const snap = await db.collection("applications").doc("a1").get();
        assert.equal(snap.exists, true);
        assert.equal(snap.get("applied_resume.content"), "Jordan Lee, RN");
    });

    it("hashes usernames and still finds the profile by one", async () => {
        await db.collection("profiles").doc("u1").set({ username: "maya", resume_text: "Maya Okonkwo" });
        const row = await raw("profiles", "profiles/u1");
        assert.ok(String(row.doc.username).startsWith("h1."));
        const found = await db.collection("profiles").where("username", "==", "maya").limit(1).get();
        assert.equal(found.size, 1);
        assert.equal(found.docs[0].id, "u1");
        assert.equal(found.docs[0].data()!.resume_text, "Maya Okonkwo");
    });

    it("merges, updates dotted paths, deletes fields and increments like Firestore", async () => {
        const ref = db.collection("profiles").doc("u2");
        await ref.set({ resume_data: { name: "A", skills: ["x"] }, resume_text: "t", views: 1 });
        await ref.set({ resume_data: { skills: ["y"] }, resume_text: FieldValue.delete() }, { merge: true });
        await ref.update({ views: FieldValue.increment(2), "prefs.digest": true });
        assert.deepEqual((await ref.get()).data(), { resume_data: { name: "A", skills: ["y"] }, views: 3, prefs: { digest: true } });
    });

    it("reports Firestore's codes for create-twice and update-missing", async () => {
        const ref = db.collection("welcome_emails").doc("u9");
        await ref.create({ email: "x@y.co" });
        await assert.rejects(ref.create({ email: "x@y.co" }), (e: { code?: number }) => e.code === 6);
        await assert.rejects(db.collection("welcome_emails").doc("nope").update({ a: 1 }), (e: { code?: number }) => e.code === 5);
    });

    it("answers queries on readable, hashed and sealed fields alike", async () => {
        const favs = db.collection("favorite_questions");
        await favs.add({ user_id: "u1", question_text: "Why us?", created_at: "2026-10-02" });
        await favs.add({ user_id: "u1", question_text: "Tell me about a conflict", created_at: "2026-10-03" });
        await favs.add({ user_id: "u2", question_text: "Why us?", created_at: "2026-10-04" });
        const mine = await favs.where("user_id", "==", "u1").orderBy("created_at", "desc").get();
        assert.deepEqual(mine.docs.map((d) => d.get("created_at")), ["2026-10-03", "2026-10-02"]);
        const same = await favs.where("user_id", "==", "u1").where("question_text", "==", "Why us?").limit(1).get();
        assert.equal(same.size, 1);
        assert.equal((await favs.where("question_text", "==", "Why us?").count().get()).data().count, 2);
        const ids = mine.docs.map((d) => d.id);
        const byId = await favs.where("__name__", "in", ids).get();
        assert.equal(byId.size, 2);
    });

    it("reads document-id ranges, subcollections and collection groups", async () => {
        await db.collection("apply_counters").doc("u1_2026-10-01").set({ n: 1 });
        await db.collection("apply_counters").doc("u1_2026-10-02").set({ n: 2 });
        await db.collection("apply_counters").doc("u10_2026-10-01").set({ n: 3 });
        const mine = await db
            .collection("apply_counters")
            .where(FieldPath.documentId(), ">=", "u1_")
            .where(FieldPath.documentId(), "<", "u1_")
            .get();
        assert.deepEqual(mine.docs.map((d) => d.id), ["u1_2026-10-01", "u1_2026-10-02"]);

        await db.collection("users").doc("u1").collection("savedSearches").doc("s1").set({ q: "nurse" });
        await db.collection("users").doc("u2").collection("savedSearches").doc("s1").set({ q: "teacher" });
        assert.equal((await db.collection("users").doc("u1").collection("savedSearches").get()).size, 1);
        const group = await db.collectionGroup("savedSearches").select().get();
        assert.deepEqual(group.docs.map((d) => d.ref.parent.parent?.id).sort(), ["u1", "u2"]);
        assert.deepEqual(group.docs[0].data(), {});
    });

    it("hashes email ids in the stored path and gives the real id back", async () => {
        await db.collection("email_suppressions").doc("person@example.com").set({ entries: { digest: "2026-10-01" } });
        const paths = (await pool.query(`SELECT path FROM intervu.email_suppressions`)).rows.map((r) => r.path);
        assert.ok(paths.every((p: string) => !p.includes("person@")));
        const snap = await db.collection("email_suppressions").doc("person@example.com").get();
        assert.equal(snap.exists, true);
        const all = await db.collection("email_suppressions").get();
        assert.deepEqual(all.docs.map((d) => d.id), ["person@example.com"]);
        await db.collection("email_suppressions").doc("person@example.com").update({ "entries.digest": FieldValue.delete() });
        assert.deepEqual((await snap.ref.get()).data(), { entries: {} });
    });

    it("commits a batch all or nothing", async () => {
        const batch = db.batch();
        batch.set(db.collection("applications").doc("b1"), { user_id: "u3" });
        batch.update(db.collection("applications").doc("missing"), { status: "x" });
        await assert.rejects(batch.commit());
        assert.equal((await db.collection("applications").doc("b1").get()).exists, false);
    });

    it("lets exactly one of two racing transactions claim a code", async () => {
        await db.collection("agent_codes").doc("c1").set({ uid: "u1", usedAt: null });
        const claim = () =>
            db.runTransaction(async (tx) => {
                const snap = (await tx.get(db.collection("agent_codes").doc("c1"))) as Awaited<ReturnType<ReturnType<PgDocDb["doc"]>["get"]>>;
                if (!snap.exists || snap.get("usedAt")) return false;
                tx.update(db.collection("agent_codes").doc("c1"), { usedAt: Date.now() });
                return true;
            });
        const results = await Promise.all([claim(), claim(), claim()]);
        assert.equal(results.filter(Boolean).length, 1);
    });

    it("counts and orders in SQL on readable fields", async () => {
        const events = db.collection("search_events");
        for (let i = 0; i < 5; i++) {
            await events.add({ q: `secret query ${i}`, createdAt: `2026-10-0${i + 1}T00:00:00.000Z`, widened: i % 2 === 0 });
        }
        assert.equal((await events.where("createdAt", ">=", "2026-10-03").count().get()).data().count, 3);
        assert.equal((await events.where("widened", "==", true).count().get()).data().count, 3);
        const latest = await db.collection("search_events").orderBy("createdAt", "desc").limit(2).get();
        assert.deepEqual(latest.docs.map((d) => d.get("q")), ["secret query 4", "secret query 3"]);
        const leaked = await pool.query(`SELECT count(*)::int AS n FROM intervu.search_events WHERE doc::text LIKE '%secret%'`);
        assert.equal(leaked.rows[0].n, 0);
    });

    it("finds every record kept under an account's email for deletion", async () => {
        await db.collection("contact_messages").add({ email: "Maya@Example.com ", message: "hi" });
        await db.collection("contact_messages").add({ email: "other@example.com", message: "hi" });
        await db.collection("connect_waitlist").doc("maya@example.com").set({ email: "maya@example.com", client: "claude" });
        await db.collection("founding_waitlist").doc("typo@example.com").set({ email: "typo@example.com", uid: "u7" });
        await db.collection("waitlist").doc("w1").set({ email: "maya@example.com", pack: "50" });
        const paths = await emailKeyedPaths(db as unknown as Parameters<typeof emailKeyedPaths>[0], "Maya@Example.com ", "u7");
        assert.deepEqual([...new Set(paths)].map((p) => p.split("/")[0]).sort(), [
            "connect_waitlist", "contact_messages", "founding_waitlist", "waitlist",
        ]);
    });

    it("still reads rows written before sealing", async () => {
        await pool.query(`INSERT INTO intervu.market_stats_daily (path, doc) VALUES ('market_stats_daily/2026-10-01', '{"date":"2026-10-01","active":5}')`);
        const snap = await db.collection("market_stats_daily").orderBy("date", "desc").limit(1).get();
        assert.equal(snap.docs[0].get("active"), 5);
    });
});
