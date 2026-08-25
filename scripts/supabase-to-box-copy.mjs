#!/usr/bin/env node
/**
 * Copy Supabase `public` tables onto the Contabo database box.
 *
 * RUNS ON THE PIPELINE BOX (194.163.147.154), not a laptop: the database box
 * only accepts connections from there.
 *
 *   node supabase-to-box-copy.mjs                        # report the plan, write nothing
 *   node supabase-to-box-copy.mjs --apply                # create + copy
 *   node supabase-to-box-copy.mjs --apply --merge-collisions
 *
 * Additive and reversible by design. It creates tables that are absent and
 * fills tables that are empty. By default it REFUSES any table that already
 * has rows on the box, because copying into one would either duplicate rows or
 * bury data written since the cutover. It changes no routing —
 * `BATCH_DB_TABLES` is untouched, so live reads and writes keep going exactly
 * where they go today. Flipping routing is a separate, deliberate step.
 *
 * `--merge-collisions` adds the refused tables back, as
 * `INSERT ... ON CONFLICT DO NOTHING`: rows the box already holds are skipped,
 * rows only Supabase has are added. That is the honest expression of "bring
 * across what is missing" and needs no per-table special-casing — a table whose
 * rows are already identical simply gains nothing.
 *
 * ⚠️ ON CONFLICT fires on CONSTRAINT collisions, not on row equality. Two rows
 * that share a primary key but differ elsewhere are SKIPPED, not merged, so the
 * merge is verified against an expected count rather than assumed to have
 * worked. A shortfall is reported loudly.
 *
 * Credentials travel in the environment, never in argv: `pg_dump`'s connection
 * URI would otherwise put the database password where `ps` can read it.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import pg from "/opt/interview-os/node_modules/pg/lib/index.js";

const APPLY = process.argv.includes("--apply");
const MERGE = process.argv.includes("--merge-collisions");
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
const DST = parts(env.PIPELINE_DATABASE_URL || env.BATCH_PG_URL);

/**
 * The connection `pg_dump` gets, which is NOT the one the app uses.
 *
 * libpq cannot talk to Supabase's Supavisor pooler at all — both the
 * transaction port (6543) and the session port (5432) reject its startup packet
 * with `Invalid startup message: :bad_startup_payload`. Verified with psql, so
 * this is not a pg_dump quirk; node-postgres speaks to the same pooler happily,
 * which is why the rest of this script works against it.
 *
 * The direct host accepts libpq normally. Its subdomain is the project ref,
 * which is also the suffix of the pooler username (`postgres.<ref>`) — derived
 * here rather than hardcoded, so this keeps working if the project changes.
 */
function dumpConnection(src) {
    if (!/\.pooler\.supabase\.com$/.test(src.host) || !src.user.includes(".")) return src;
    return {
        ...src,
        host: `db.${src.user.slice(src.user.indexOf(".") + 1)}.supabase.co`,
        port: "5432",
        user: src.user.slice(0, src.user.indexOf(".")),
    };
}
const SRC_DUMP = dumpConnection(SRC);

async function connect(p, label) {
    const c = new pg.Client({ ...p, ssl: { rejectUnauthorized: false } });
    await c.connect();
    // Both ends render timestamps in the same zone, so the row comparison below
    // compares DATA. `timestamptz::text` formats in the session's time zone, and
    // these two servers do not share one — without this, identical rows
    // stringify differently and every row reads as missing. That mis-measurement
    // is what made domain_aliases look like it needed a 3-row merge.
    await c.query("set time zone 'UTC'");
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

/**
 * Create any enum types the box is missing, before the tables that use them.
 *
 * `pg_dump --table=` emits the tables and nothing else — user-defined types a
 * column depends on are NOT included, so a restore dies on the first column
 * declared as one. Rather than fix the type that happened to surface, this
 * copies every enum in the source's public schema that the destination lacks.
 *
 * Types are created outside the restore's transaction because a type must exist
 * before the table referencing it is parsed.
 */
async function ensureEnumTypes(src, dst) {
    const { rows: wanted } = await src.query(`
        -- ::text matters: enumlabel is of the name type, and node-postgres
        -- hands back a name[] as a raw string instead of parsing it.
        select t.typname::text, array_agg(e.enumlabel::text order by e.enumsortorder) labels
        from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
        group by t.typname order by t.typname`);
    const { rows: have } = await dst.query(`
        select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typtype = 'e'`);
    const present = new Set(have.map((r) => r.typname));
    const missing = wanted.filter((t) => !present.has(t.typname));
    if (!missing.length) {
        console.log(`\nenum types: ${wanted.length} in source, all present on the box`);
        return;
    }
    console.log(`\nenum types: creating ${missing.length} missing of ${wanted.length}`);
    for (const t of missing) {
        const labels = t.labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(", ");
        await dst.query(`create type public."${t.typname}" as enum (${labels})`);
        console.log(`  created ${t.typname} (${t.labels.length} labels)`);
    }
}

/**
 * Create any functions the box is missing, before the triggers that call them.
 *
 * Same gap as the enum types, one layer up: `pg_dump --table=` emits the
 * triggers defined on a table but not the functions those triggers invoke, so
 * the restore dies on the first `CREATE TRIGGER ... EXECUTE FUNCTION`.
 *
 * Failures are counted and reported rather than swallowed — a function that
 * cannot be created here becomes a trigger failure later, and a silent skip
 * would just move the confusion downstream.
 */
async function ensureFunctions(src, dst) {
    const defsOf = async (c) =>
        (await c.query(`
            select p.proname::text name, pg_get_functiondef(p.oid) def
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind in ('f', 'p')
            order by p.proname`)).rows;
    const wanted = await defsOf(src);
    const present = new Set((await defsOf(dst)).map((r) => r.name));
    const missing = wanted.filter((r) => !present.has(r.name));
    if (!missing.length) {
        console.log(`functions: ${wanted.length} in source, all present on the box`);
        return;
    }
    console.log(`functions: creating ${missing.length} missing of ${wanted.length}`);
    let failed = 0;
    for (const fn of missing) {
        try {
            await dst.query(fn.def);
        } catch (e) {
            failed++;
            console.log(`  FAILED ${fn.name}: ${e.message.replace(/\s+/g, " ").slice(0, 100)}`);
        }
    }
    console.log(`  created=${missing.length - failed} failed=${failed}`);
}

/**
 * Remove statements that reach into a schema the destination does not have.
 *
 * `profiles` carries a foreign key to Supabase's `auth.users`. Identity lives in
 * WorkOS now, so on the box that constraint refers to nothing and cannot be
 * satisfied — pg_dump adds foreign keys after the data loads, so even a stub
 * `auth` schema would fail on the first row. Dropping the constraint is the
 * honest outcome of having moved auth out of the database.
 *
 * COPY blocks are stepped over rather than parsed: their payload is raw data
 * and may contain anything, including the word being searched for.
 */
function filterDumpStatements(file, shouldDrop, label) {
    const lines = readFileSync(file, "utf8").split("\n");
    const kept = [];
    const dropped = [];
    let statement = [];
    let inCopy = false;

    for (const line of lines) {
        if (inCopy) {
            kept.push(line);
            if (line === "\\.") inCopy = false;
            continue;
        }
        if (/^COPY .* FROM stdin;$/.test(line)) {
            kept.push(line);
            inCopy = true;
            continue;
        }
        statement.push(line);
        if (!line.trimEnd().endsWith(";")) continue;

        // pg_dump prefixes every statement with a `-- Name: ...` comment block.
        // The predicate is shown the SQL without it, so an anchored match like
        // /^CREATE POLICY/ sees what it expects instead of the comment.
        const body = [...statement];
        while (body.length && (body[0].trim() === "" || body[0].trimStart().startsWith("--"))) body.shift();
        const sql = body.join("\n");
        if (shouldDrop(sql)) dropped.push(sql.replace(/\s+/g, " ").trim().slice(0, 90));
        else kept.push(...statement);
        statement = [];
    }
    kept.push(...statement);

    if (dropped.length) {
        console.log(`\nstripped ${dropped.length} statement(s) — ${label}:`);
        for (const d of dropped.slice(0, 8)) console.log(`  ${d}`);
        if (dropped.length > 8) console.log(`  … and ${dropped.length - 8} more`);
        writeFileSync(file, kept.join("\n"));
    }
    return dropped.length;
}

/**
 * Supabase's access control does not travel with the data.
 *
 * RLS on Supabase is enforced against roles PostgREST supplies — `anon`,
 * `authenticated`, `service_role` — none of which exist on the box, where our
 * own server connects as a single role. Policies and grants naming a role the
 * destination lacks simply cannot be created.
 *
 * `ENABLE ROW LEVEL SECURITY` has to go with them, and that is the part worth
 * being careful about: enabling RLS while dropping every policy would leave the
 * table readable by nobody but its owner, which looks like a successful restore
 * and behaves like data loss.
 */
function isSupabaseAccessControl(sql, knownRoles) {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^CREATE POLICY\b/i.test(s)) return true;
    if (/^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;$/i.test(s)) return true;
    const grant = s.match(/^(?:GRANT|REVOKE)\b.*?\b(?:TO|FROM)\s+([^;]+);$/i);
    if (!grant) return false;
    return grant[1]
        .split(",")
        .map((r) => r.trim().replace(/^"|"$/g, ""))
        .some((r) => r && !/^(PUBLIC|CURRENT_USER|SESSION_USER)$/i.test(r) && !knownRoles.has(r));
}

/** Dump the named tables from Supabase and restore them onto the box. */
function dumpAndRestore(tables, extraDumpArgs, label, knownRoles) {
    const args = ["--no-owner", "--no-acl", "--schema=public", ...extraDumpArgs];
    // One dump for ALL tables rather than one per table: pg_dump then orders
    // them and emits constraints last, so foreign keys between them resolve.
    for (const t of tables) args.push(`--table=public.${t.name}`);
    args.push("--file", DUMP_FILE);

    console.log(`\n${label}: dumping ${tables.length} table(s)…`);
    execFileSync("/usr/bin/pg_dump", args, {
        env: {
            ...process.env,
            PGHOST: SRC_DUMP.host, PGPORT: SRC_DUMP.port, PGUSER: SRC_DUMP.user,
            PGPASSWORD: SRC_DUMP.password, PGDATABASE: SRC_DUMP.database, PGSSLMODE: "require",
        },
        stdio: ["ignore", "inherit", "inherit"],
    });
    console.log(`dump_bytes=${readFileSync(DUMP_FILE).length}`);
    // Auth moved to WorkOS; the box has no `auth` schema and should not gain one.
    filterDumpStatements(DUMP_FILE, (sql) => /\bauth\./.test(sql), 'referencing schema "auth"');
    filterDumpStatements(
        DUMP_FILE,
        (sql) => isSupabaseAccessControl(sql, knownRoles),
        "Supabase RLS and grants to roles this server does not have",
    );

    // ON_ERROR_STOP + a single transaction: a partial restore is worse than no
    // restore, because it looks like it worked.
    console.log(`${label}: restoring onto the box…`);
    execFileSync("/usr/bin/psql", ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", DUMP_FILE], {
        env: {
            ...process.env,
            PGHOST: DST.host, PGPORT: DST.port, PGUSER: DST.user,
            PGPASSWORD: DST.password, PGDATABASE: DST.database,
        },
        stdio: ["ignore", "inherit", "inherit"],
    });
    unlinkSync(DUMP_FILE);
}

/**
 * How many of Supabase's rows are genuinely not on the box?
 *
 * Compares whole rows across the columns both sides share, so schema drift does
 * not read as a data difference. This is what makes the merge verifiable: it
 * gives an expected post-merge count instead of "the command exited 0".
 */
async function absentRowCount(src, dst, table) {
    const colsOf = async (c) =>
        (await c.query(
            `select column_name from information_schema.columns
             where table_schema='public' and table_name=$1 order by column_name`, [table],
        )).rows.map((r) => r.column_name);
    const [a, b] = [await colsOf(src), await colsOf(dst)];
    const shared = a.filter((x) => b.includes(x));
    if (!shared.length) return null;
    const sel = shared.map((c) => `"${c}"::text`).join(" || '|' || ");
    const digest = async (c) =>
        (await c.query(`select coalesce(${sel}, '') r from public."${table}"`)).rows
            .map((r) => createHash("sha1").update(r.r).digest("hex"));
    const boxRows = new Set(await digest(dst));
    return (await digest(src)).filter((h) => !boxRows.has(h)).length;
}

async function main() {
    const src = await connect(SRC, "supabase");
    const dst = await connect(DST, "box     ");

    // Asked of the destination, not assumed: a grant naming a role the box does
    // not have is unrestorable, and which roles it has is a property of the box.
    const knownRoles = new Set((await dst.query("select rolname::text from pg_roles")).rows.map((r) => r.rolname));

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

    // Expected post-merge counts are computed BEFORE anything is written, so
    // the check afterwards compares against a number the run cannot influence.
    const merging = MERGE ? collisions : [];
    const expectedAfterMerge = new Map();
    for (const t of merging) {
        const absent = await absentRowCount(src, dst, t.name);
        const before = dstCounts.get(t.name) ?? 0;
        expectedAfterMerge.set(t.name, absent === null ? null : before + absent);
        console.log(
            `  MERGE ${t.name}: box=${before} + ${absent ?? "?"} absent from supabase -> expect ${absent === null ? "?" : before + absent}`,
        );
    }

    if (!APPLY) {
        console.log(`\ndry run — nothing written. re-run with --apply${MERGE ? " --merge-collisions" : ""}`);
        await src.end(); await dst.end();
        process.exit(0);
    }
    if (!copyable.length && !merging.length) {
        console.log("\nnothing to copy");
        await src.end(); await dst.end();
        process.exit(0);
    }

    if (copyable.length) {
        await ensureEnumTypes(src, dst);
        await ensureFunctions(src, dst);
        dumpAndRestore(copyable, [], "copy", knownRoles);
        // Again, now the tables exist: a function whose body names one of them
        // cannot be created before it, so the first pass necessarily misses it.
        await ensureFunctions(src, dst);
    }

    // Data-only, and every row an INSERT that yields to whatever the box
    // already holds. Schema is NOT re-emitted: these tables exist there.
    if (merging.length) {
        dumpAndRestore(merging, ["--data-only", "--inserts", "--on-conflict-do-nothing"], "merge", knownRoles);
    }

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
    for (const t of merging) {
        const got = after.get(t.name) ?? 0;
        const want = expectedAfterMerge.get(t.name);
        const ok = want !== null && got === want;
        if (!ok) mismatched++;
        // A shortfall here means rows collided on a constraint rather than
        // merging — same key, different data. That needs a human, not a retry.
        console.log(
            `  ${ok ? "ok  " : "SHORTFALL"} merge ${t.name}: expected ${want ?? "?"} got ${got}` +
            (ok ? "" : "  <- rows share a key but differ; resolve by hand"),
        );
    }
    console.log(`\nresult copied=${copyable.length} merged=${merging.length} mismatched=${mismatched}`);
    await src.end(); await dst.end();
    process.exit(mismatched ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
