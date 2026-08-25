#!/usr/bin/env node
/**
 * Copy Supabase `public` tables onto the Contabo database box.
 *
 * RUNS ON THE PIPELINE BOX (194.163.147.154), not a laptop: the database box
 * only accepts connections from there.
 *
 *   node supabase-to-box-copy.mjs            # report the plan, write nothing
 *   node supabase-to-box-copy.mjs --apply    # create + copy
 *
 * Additive and reversible by design. It creates tables that are absent and
 * fills tables that are empty; it REFUSES any table that already has rows on
 * the box, because copying into one would either duplicate rows or bury data
 * written since the cutover. It changes no routing — `BATCH_DB_TABLES` is
 * untouched, so live reads and writes keep going exactly where they go today.
 * Flipping routing is a separate, deliberate step.
 *
 * Credentials travel in the environment, never in argv: `pg_dump`'s connection
 * URI would otherwise put the database password where `ps` can read it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import pg from "/opt/interview-os/node_modules/pg/lib/index.js";

const APPLY = process.argv.includes("--apply");
const DUMP_FILE = "/tmp/supabase-exit-dump.sql";

function loadEnv(path) {
    const out = {};
    for (const line of readFileSync(path, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m) continue;
        out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
}

const env = loadEnv("/opt/interview-os/.env.local");

/** Connection parts, so nothing has to be handed to a subprocess as a URI. */
function parts(url) {
    const u = new URL(url);
    return {
        host: u.hostname,
        port: u.port || "5432",
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.slice(1) || "postgres",
    };
}

const SRC = parts(env.DATABASE_URL);
// pg_dump needs a SESSION connection. Supabase's pooler serves transaction mode
// on 6543 and session mode on 5432; a transaction-mode connection cannot hold
// the state a dump requires.
const SRC_DUMP_PORT = SRC.port === "6543" ? "5432" : SRC.port;
const DST = parts(env.PIPELINE_DATABASE_URL || env.BATCH_PG_URL);

async function connect(p, label) {
    const c = new pg.Client({ ...p, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const who = await c.query("select inet_server_addr()::text a, current_database() d");
    console.log(`${label}: server=${who.rows[0].a} db=${who.rows[0].d}`);
    return c;
}

async function counts(client) {
    const { rows } = await client.query(`
        select table_name from information_schema.tables
        where table_schema='public' and table_type='BASE TABLE' order by table_name`);
    const out = new Map();
    for (const { table_name } of rows) {
        const r = await client.query(`select count(*)::int n from public."${table_name}"`);
        out.set(table_name, r.rows[0].n);
    }
    return out;
}

async function main() {
    const src = await connect(SRC, "supabase");
    const dst = await connect(DST, "box     ");

    const srcCounts = await counts(src);
    const dstCounts = await counts(dst);

    const source = [...srcCounts].filter(([, n]) => n > 0).map(([name, n]) => ({ name, n }));
    const collisions = source.filter((t) => (dstCounts.get(t.name) ?? 0) > 0);
    const copyable = source.filter((t) => (dstCounts.get(t.name) ?? 0) === 0);

    console.log(`\nsupabase_non_empty=${source.length} copyable=${copyable.length} collisions=${collisions.length}`);
    for (const t of collisions) {
        console.log(`  COLLISION supabase=${t.n} box=${dstCounts.get(t.name)}  ${t.name}`);
    }
    console.log(`\nplan (${copyable.length} tables, ${copyable.reduce((a, t) => a + t.n, 0)} rows):`);
    for (const t of copyable) {
        console.log(`  ${String(t.n).padStart(9)}  ${t.name}  ${dstCounts.has(t.name) ? "(exists, empty)" : "(absent)"}`);
    }

    if (!APPLY) {
        console.log("\ndry run — nothing written. re-run with --apply");
        await src.end(); await dst.end();
        process.exit(0);
    }
    if (!copyable.length) {
        console.log("\nnothing to copy");
        await src.end(); await dst.end();
        process.exit(0);
    }

    // One dump for ALL tables rather than one per table: pg_dump then orders
    // them and emits constraints last, so foreign keys between them resolve.
    const args = ["--no-owner", "--no-acl", "--schema=public"];
    for (const t of copyable) args.push(`--table=public.${t.name}`);
    args.push("--file", DUMP_FILE);

    console.log(`\ndumping ${copyable.length} tables…`);
    execFileSync("/usr/bin/pg_dump", args, {
        env: {
            ...process.env,
            PGHOST: SRC.host, PGPORT: SRC_DUMP_PORT, PGUSER: SRC.user,
            PGPASSWORD: SRC.password, PGDATABASE: SRC.database, PGSSLMODE: "require",
        },
        stdio: ["ignore", "inherit", "inherit"],
    });
    const bytes = readFileSync(DUMP_FILE).length;
    console.log(`dump_bytes=${bytes}`);

    // ON_ERROR_STOP + a single transaction: a partial restore is worse than no
    // restore, because it looks like it worked.
    console.log("restoring onto the box…");
    execFileSync("/usr/bin/psql", ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", DUMP_FILE], {
        env: {
            ...process.env,
            PGHOST: DST.host, PGPORT: DST.port, PGUSER: DST.user,
            PGPASSWORD: DST.password, PGDATABASE: DST.database,
        },
        stdio: ["ignore", "inherit", "inherit"],
    });
    unlinkSync(DUMP_FILE);

    // Verify against the DESTINATION, not against the dump's own report.
    const after = await counts(dst);
    let mismatched = 0;
    console.log("\nverification (supabase -> box):");
    for (const t of copyable) {
        const got = after.get(t.name) ?? 0;
        const ok = got === t.n;
        if (!ok) mismatched++;
        console.log(`  ${ok ? "ok  " : "MISMATCH"} ${String(t.n).padStart(9)} -> ${String(got).padStart(9)}  ${t.name}`);
    }
    console.log(`\nresult copied=${copyable.length} mismatched=${mismatched}`);
    await src.end(); await dst.end();
    process.exit(mismatched ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
