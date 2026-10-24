/**
 * A sealed row keeps the lookup layout it was written with. Needs the same
 * scratch Postgres as docstore-pg.test.ts; skipped unless DOCSTORE_TEST_PG_URL names one.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { Pool } from "pg";

import { storeEraseDeps } from "../../src/lib/account/erase-account";
import { runUserDataPlan } from "../../src/lib/db/user-data";
import { layoutOf } from "../../src/lib/db/docstore/layout";
import { createPgDocDb, type PgDocDb } from "../../src/lib/db/docstore/pg-docstore";
import { allCollections, reencodeCollection } from "../../src/lib/db/docstore/reencode";
import { deriveDocKeys } from "../../src/lib/db/docstore/seal";
import { parseReencodeArgs } from "../../scripts/reencode-docstore-collection";

const URL = process.env.DOCSTORE_TEST_PG_URL;
const UID = "reencodeUid1";

describe("re-encode drifted docstore rows", { skip: !URL && "DOCSTORE_TEST_PG_URL not set" }, () => {
    let pool: Pool;
    let db: PgDocDb;
    const clean = async () => {
        for (const t of ["credit_grants", "agent_credentials"]) await pool.query(`DELETE FROM intervu."${t}"`);
    };
    before(async () => {
        pool = new Pool({ connectionString: URL, max: 4 });
        db = createPgDocDb(pool, deriveDocKeys("cd".repeat(32)));
        await clean();
    });
    after(async () => {
        await clean();
        await pool.end();
    });

    /** Seals a row exactly as the store did before the layout gained `field`. */
    const sealUnderOldLayout = async (collection: string, path: string, data: Record<string, unknown>, field: string) => {
        const layout = layoutOf(collection);
        const old = { ...layout, readable: new Set([...layout.readable].filter((f) => f !== field)) };
        const client = await pool.connect();
        try {
            await db.engine.write(client, old, path, data, "upsert");
        } finally {
            client.release();
        }
    };
    const ownedBy = async (uid: string) =>
        Object.values(await runUserDataPlan(uid, db as unknown as Firestore)).flatMap((docs) => docs.map((d) => d.path));

    const cases = [
        { collection: "credit_grants", path: `credit_grants/welcome:${UID}`, data: { uid: UID, amount: 3, reason: "welcome", granted_at: "2026-01-01" }, field: "uid" },
        { collection: "agent_credentials", path: "agent_credentials/cred1", data: { uid: UID, kind: "manual", created_at: "2026-10-01", label: "x" }, field: "uid" },
    ];

    for (const c of cases) {
        it(`${c.collection}: a row sealed before ${c.field} was readable is missed, then found and erased after re-encode`, async () => {
            await sealUnderOldLayout(c.collection, c.path, c.data, c.field);
            assert.ok(!(await ownedBy(UID)).includes(c.path), "sweep misses the drifted row");

            const dry = await reencodeCollection(db, c.collection, false);
            assert.deepEqual([dry.scanned, dry.drifted, dry.rewritten], [1, 1, 0]);
            assert.ok(!(await ownedBy(UID)).includes(c.path), "dry run writes nothing");

            const applied = await reencodeCollection(db, c.collection, true);
            assert.deepEqual([applied.drifted, applied.rewritten], [1, 1]);
            assert.equal((await reencodeCollection(db, c.collection, false)).drifted, 0);
            assert.deepEqual((await db.doc(c.path).get()).data(), c.data, "document unchanged");

            assert.ok((await ownedBy(UID)).includes(c.path), "sweep finds the re-encoded row");
            await storeEraseDeps(db as unknown as Firestore).deletePaths([c.path]);
            assert.equal((await db.doc(c.path).get()).exists, false);
        });
    }
});

describe("reencode args", () => {
    it("takes exactly one of --collection or --all; dry run unless --apply", () => {
        assert.deepEqual(parseReencodeArgs(["--collection=credit_grants"]), { collections: ["credit_grants"], apply: false });
        assert.deepEqual(parseReencodeArgs(["--all", "--apply"]), { collections: allCollections(), apply: true });
        assert.ok("error" in parseReencodeArgs([]));
        assert.ok("error" in parseReencodeArgs(["--all", "--collection=x"]));
    });
});
