#!/usr/bin/env node
/**
 * The Firestore exit, step 4: delete every document in Firestore, after
 * proving Postgres holds each one sealed. Vivek runs this himself.
 *
 *   node firestore-wipe.cjs          # check only: what would go, and whether Postgres has it all
 *   node firestore-wipe.cjs --yes    # check, then delete everything
 *
 * IRREVERSIBLE. After this there is no Firestore to switch back to; the only
 * copy of account data is the sealed Postgres one (and its B2 backups), and
 * only DATA_ENCRYPTION_KEY opens it. It refuses to delete anything unless
 * the same check scripts/firestore-to-postgres.ts --verify runs passes,
 * which means every document, in every collection Firestore reports
 * (including ones no code mentions), is in Postgres and sealed.
 *
 * Runs where the copy runs: inside the Velai container on the web box, with
 * DATA_STORE=postgres already live (so nothing writes to Firestore any more).
 */
import { Pool } from "pg";

import { getFirestoreDb, usesPostgresStore } from "../src/lib/firebase/admin";
import { createPgDocDb } from "../src/lib/db/docstore/pg-docstore";
import { docKeysFromEnv } from "../src/lib/db/docstore/seal";
import { checkTables, inventoryFirestore, printChecks } from "./lib/firestore-exit";

const log = (line: string) => console.log(line);

async function main(): Promise<void> {
    const yes = process.argv.includes("--yes");
    if (!usesPostgresStore()) {
        throw new Error("DATA_STORE is not 'postgres' here: the app may still be writing to Firestore, so nothing will be deleted");
    }
    const url = process.env.DATA_PG_URL?.trim();
    if (!url) throw new Error("DATA_PG_URL is not set");
    const pool = new Pool({ connectionString: url, max: 2 });
    const engine = createPgDocDb(pool, docKeysFromEnv()).engine;
    const fs = getFirestoreDb();

    log("reading Firestore...");
    const inv = await inventoryFirestore(fs, log);
    log("checking every Firestore document is in Postgres, sealed...");
    const ok = printChecks(await checkTables(engine, pool, inv), log);
    await pool.end();
    if (!ok) {
        log("\nNOT deleting: Postgres is missing documents (above). Run firestore-to-postgres --apply first.");
        process.exit(1);
    }

    const roots = (await fs.listCollections()).map((c) => c.id);
    if (!yes) {
        log(`\nCheck passed. --yes would delete these root collections and everything under them:\n  ${roots.join(", ")}`);
        return;
    }

    for (const id of roots) {
        log(`deleting ${id} and everything under it...`);
        await fs.recursiveDelete(fs.collection(id));
    }
    const left = (await fs.listCollections()).map((c) => c.id);
    if (left.length) {
        log(`\nStill present after delete: ${left.join(", ")}. Run again.`);
        process.exit(1);
    }
    log("\nFirestore is empty.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
