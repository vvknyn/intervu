#!/usr/bin/env node
/**
 * The Firestore exit, step 3: copy every Firestore document into the sealed
 * Postgres store, then check that each one arrived.
 *
 *   node firestore-to-postgres.cjs                        # plan: counts only, writes nothing
 *   node firestore-to-postgres.cjs --apply                # copy, prune stale rows, verify
 *   node firestore-to-postgres.cjs --apply --flipped-at=<ISO time DATA_STORE=postgres went live>
 *   node firestore-to-postgres.cjs --verify               # compare only
 *
 * Runs on the web box inside the Velai container, which already has the
 * Firestore credentials and (for this step) DATA_PG_URL and
 * DATA_ENCRYPTION_KEY; the DB box only accepts connections from there. Bundle
 * it first (see release-30 deploy brief): `npx esbuild
 * scripts/firestore-to-postgres.ts --bundle --platform=node --format=cjs
 * --external:pg --external:firebase-admin --outfile=firestore-to-postgres.cjs`.
 *
 * WHAT --apply DOES, table by table:
 *  1. Seals and upserts every Firestore document at its path.
 *  2. Collections already live on Postgres (AGENT_PG_LIVE_COLLECTIONS) are
 *     NOT copied from Firestore, whose copy is stale; their plain rows are
 *     resealed in place.
 *  3. Deletes rows Firestore no longer has: the old plain one-off copy of
 *     since-deleted documents, and plain rows at email paths now stored
 *     hashed. This is what makes the copy match, so it is part of --apply.
 *  4. Copies documents in collections the manifest doesn't list into
 *     intervu.legacy_docs, sealed.
 *  5. Opens every row and compares with Firestore; exits 1 on any gap.
 *
 * THE SECOND PASS. Firestore keeps taking writes until DATA_STORE=postgres is
 * live, so run --apply again right after the switch with --flipped-at. It
 * never overwrites or prunes a row the app has written since that moment
 * (copied_at is stamped on every write), so it only fills the gap.
 */
import { Pool } from "pg";

import { getFirestoreDb } from "../src/lib/firebase/admin";
import { createPgDocDb } from "../src/lib/db/docstore/pg-docstore";
import { docKeysFromEnv, seal } from "../src/lib/db/docstore/seal";
import { layoutOf } from "../src/lib/db/docstore/layout";
import {
    LEGACY_TABLE,
    checkTables,
    inventoryFirestore,
    legacyKey,
    pgSourcedCollections,
    printChecks,
} from "./lib/firestore-exit";

const log = (line: string) => console.log(line);
const BATCH = 500;

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const apply = args.includes("--apply");
    const verifyOnly = args.includes("--verify");
    const flippedArg = args.find((a) => a.startsWith("--flipped-at="));
    const flippedAt = flippedArg ? new Date(flippedArg.slice("--flipped-at=".length)) : null;
    if (flippedAt && Number.isNaN(flippedAt.getTime())) throw new Error(`bad --flipped-at: ${flippedArg}`);

    const url = process.env.DATA_PG_URL?.trim();
    if (!url) throw new Error("DATA_PG_URL is not set");
    const pool = new Pool({ connectionString: url, max: 2 });
    const engine = createPgDocDb(pool, docKeysFromEnv()).engine;
    const fs = getFirestoreDb();

    log("reading Firestore...");
    const inv = await inventoryFirestore(fs, log);
    const total = [...inv.known.values()].reduce((n, d) => n + d.length, 0) + inv.legacy.length;
    log(`${total} documents across ${inv.known.size} manifest collections and ${inv.legacy.length} legacy documents`);

    if (apply) {
        const pgSourced = pgSourcedCollections();
        // Rows written by the app after the switch are left exactly as they are.
        const guard = flippedAt ? ` WHERE t.copied_at <= $4` : "";
        for (const [collection, docs] of inv.known) {
            const layout = layoutOf(collection);
            const table = engine.table(layout);
            if (pgSourced.has(collection)) {
                const { rows } = await pool.query<{ path: string; doc: Record<string, unknown> }>(
                    `SELECT path, doc FROM ${table} WHERE sealed IS NULL`,
                );
                for (const row of rows) {
                    const enc = engine.encode(layout, row.path, row.doc);
                    await pool.query(`UPDATE ${table} SET doc = $2::jsonb, sealed = $3 WHERE path = $1 AND sealed IS NULL`, [
                        row.path,
                        enc.doc,
                        enc.sealed,
                    ]);
                }
                log(`  ${collection}: resealed ${rows.length} rows in place (live on Postgres; Firestore copy ignored)`);
                continue;
            }

            const kept: string[] = [];
            for (let i = 0; i < docs.length; i += BATCH) {
                const client = await pool.connect();
                try {
                    await client.query("BEGIN");
                    for (const doc of docs.slice(i, i + BATCH)) {
                        const enc = engine.encode(layout, doc.path, doc.data);
                        kept.push(enc.path);
                        await client.query(
                            `INSERT INTO ${table} AS t (path, doc, sealed, copied_at) VALUES ($1, $2::jsonb, $3, now())
                             ON CONFLICT (path) DO UPDATE SET doc = EXCLUDED.doc, sealed = EXCLUDED.sealed, copied_at = now()${guard}`,
                            flippedAt ? [enc.path, enc.doc, enc.sealed, flippedAt.toISOString()] : [enc.path, enc.doc, enc.sealed],
                        );
                    }
                    await client.query("COMMIT");
                } catch (err) {
                    await client.query("ROLLBACK").catch(() => {});
                    throw err;
                } finally {
                    client.release();
                }
            }
            const pruned = await pool.query(
                `DELETE FROM ${table} WHERE NOT (path = ANY($1::text[]))${flippedAt ? " AND copied_at <= $2" : ""}`,
                flippedAt ? [kept, flippedAt.toISOString()] : [kept],
            );
            log(`  ${collection}: ${docs.length} sealed, ${pruned.rowCount ?? 0} stale rows removed`);
        }

        for (const doc of inv.legacy) {
            const key = legacyKey(engine, doc.path);
            await pool.query(
                `INSERT INTO ${LEGACY_TABLE} (path, sealed, copied_at) VALUES ($1, $2, now())
                 ON CONFLICT (path) DO UPDATE SET sealed = EXCLUDED.sealed, copied_at = now()`,
                [key, seal(engine.keys, key, { p: doc.path, d: doc.data })],
            );
        }
        if (inv.legacy.length) log(`  legacy_docs: ${inv.legacy.length} sealed`);
    }

    if (apply || verifyOnly) {
        log("\nchecking every row against Firestore...");
        const ok = printChecks(await checkTables(engine, pool, inv), log);
        log(ok ? "\nOK: every Firestore document is in Postgres, sealed." : "\nNOT OK: see missing/unsealed above.");
        await pool.end();
        process.exit(ok ? 0 : 1);
    }

    log("\nplan only (nothing written). Per collection:");
    for (const [collection, docs] of inv.known) log(`  ${collection.padEnd(24)} ${docs.length}`);
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
