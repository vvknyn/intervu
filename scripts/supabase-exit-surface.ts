#!/usr/bin/env node
/**
 * What is actually left in Supabase, and which of it still matters.
 *
 *   npx tsx scripts/supabase-exit-surface.ts
 *
 * Partitions every non-empty `public` table into two piles:
 *
 *   ROUTED   — already in `BATCH_DB_TABLES`, so live writes go to the Contabo
 *              box. The Supabase copy is residue from before the cutover, not
 *              live data.
 *   REMAINDER— not routed anywhere. This is the real migration surface.
 *
 * Counts are exact `count(*)`. `pg_stat_user_tables.n_live_tup` is a planner
 * estimate maintained by autovacuum, and on a database that stopped taking
 * writes it goes stale and UNDER-reports — it once claimed 1 non-empty table
 * here when the truth was 38. An emptiness claim from an estimate is how a
 * migration decides it has nothing left to do.
 *
 * The routing list is READ, never hardcoded: `BATCH_DB_TABLES` is an
 * environment variable, so any list written into source would be a snapshot
 * that silently drifts from what the box is actually doing.
 */
import { config } from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

// The sibling repo's env gets its own object: both repos define DATABASE_URL
// and they mean different databases, and dotenv does not overwrite an
// already-set variable, so merging them resolves silently to whichever loaded
// first.
const SUBSPACE_ENV: Record<string, string> = {};
config({
    path: process.env.SUBSPACE_ENV_FILE ?? "/Users/vivek/Antigravity/Code/interview-os/.env.local",
    processEnv: SUBSPACE_ENV,
    quiet: true,
});

const databaseUrl = process.env.SUPABASE_DB_URL ?? SUBSPACE_ENV.DATABASE_URL;
if (!databaseUrl) {
    console.error("no Supabase connection string: set SUPABASE_DB_URL or SUBSPACE_ENV_FILE");
    process.exit(1);
}

const routed = new Set(
    (process.env.BATCH_DB_TABLES ?? SUBSPACE_ENV.BATCH_DB_TABLES ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
);

async function main() {
    const db = new pg.Client({ connectionString: databaseUrl!, ssl: { rejectUnauthorized: false } });
    await db.connect();

    // Prove which server answered before believing any number it returns.
    const who = await db.query("select inet_server_addr()::text a, current_database() d");
    console.log(`source=${who.rows[0].a} db=${who.rows[0].d}`);
    console.log(`routed_to_box=${routed.size} (from BATCH_DB_TABLES; the BOX copy is authoritative)`);

    const { rows: tables } = await db.query(`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name
    `);

    const counted: { name: string; count: number }[] = [];
    for (const { table_name } of tables) {
        const res = await db.query(`select count(*)::int n from public."${table_name}"`);
        counted.push({ name: table_name, count: res.rows[0].n });
    }
    await db.end();

    const nonEmpty = counted.filter((t) => t.count > 0);
    const residue = nonEmpty.filter((t) => routed.has(t.name));
    const remainder = nonEmpty.filter((t) => !routed.has(t.name));

    console.log(`\ntables=${counted.length} non_empty=${nonEmpty.length} empty=${counted.length - nonEmpty.length}`);

    console.log(`\n=== ROUTED — live writes already go to the box; Supabase copy is residue (${residue.length}) ===`);
    for (const t of residue) console.log(`  ${String(t.count).padStart(9)}  ${t.name}`);

    console.log(`\n=== REMAINDER — the real migration surface (${remainder.length}) ===`);
    for (const t of remainder) console.log(`  ${String(t.count).padStart(9)}  ${t.name}`);

    // A routed table that is EMPTY in Supabase is already fully cut over; a
    // routed name that does not exist here at all is worth knowing about too.
    const routedMissing = [...routed].filter((n) => !counted.some((t) => t.name === n));
    if (routedMissing.length) console.log(`\nrouted_but_absent_in_supabase: ${routedMissing.join(", ")}`);

    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
