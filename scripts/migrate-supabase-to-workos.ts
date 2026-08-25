#!/usr/bin/env node
/**
 * Migrate Supabase Auth users into WorkOS User Management.
 *
 *   npx tsx scripts/migrate-supabase-to-workos.ts --dry-run   # report only
 *   npx tsx scripts/migrate-supabase-to-workos.ts             # create/update
 *   npx tsx scripts/migrate-supabase-to-workos.ts --prod      # target production
 *
 * These are subspace's users, and one WorkOS environment now serves both
 * products, so every user created here is placed in the **Subspace**
 * organization and tagged `metadata.apps=subspace`. See
 * `src/lib/auth/workos-apps.ts` for why there are two mechanisms.
 *
 * Reads Supabase live rather than a dump: an export goes stale the moment
 * someone signs up, and the point is that nobody is left behind.
 *
 * Credentials: `DATABASE_URL` lives in the SUBSPACE repo's `.env.local`, not
 * intervu's — intervu talks to the box and has no Supabase vars of its own.
 * Password hashes are read into memory and sent to WorkOS over TLS; they are
 * never logged, written to disk, or placed in argv.
 */
import { config } from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { toWorkosUserPayload } from "../src/lib/auth/supabase-to-workos.ts";
import { classifyIdentity } from "../src/lib/auth/test-identity.ts";
import {
    createClient,
    ensureMembership,
    ensureOrganization,
    findUserByEmail,
    upsertUser,
} from "./workos-sync.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

/**
 * Supabase's connection string, resolved without a name collision.
 *
 * `DATABASE_URL` is defined by BOTH repos and means different databases in
 * each: intervu's points at the Contabo box, subspace's at Supabase. dotenv
 * does not overwrite a variable that is already set, so merging the two files
 * into one `process.env` silently resolves to whichever loaded first — and the
 * failure would not look like a config error, it would look like Supabase
 * having no users.
 *
 * So the sibling file is parsed into its OWN object and never reaches
 * `process.env`. `SUPABASE_DB_URL` overrides it when set, which is what makes
 * this runnable from anywhere rather than only from this machine.
 */
const SUBSPACE_ENV: Record<string, string> = {};
config({
    path: process.env.SUBSPACE_ENV_FILE ?? "/Users/vivek/Antigravity/Code/interview-os/.env.local",
    processEnv: SUBSPACE_ENV,
    quiet: true,
});

const DRY_RUN = process.argv.includes("--dry-run");
const PROD = process.argv.includes("--prod");

function requireEnv(name: string): string {
    const value = process.env[name];
    // Fail loudly. A migration that silently skips users because a key was
    // absent is indistinguishable from one that had nothing to do.
    if (!value) {
        console.error(`missing required env var: ${name}`);
        process.exit(1);
    }
    return value;
}

// Production is opt-in and uses a SEPARATE variable, so a normal run can never
// reach it by accident and local dev never has to point at the live tenant.
const apiKey = PROD ? requireEnv("WORKOS_PROD_API_KEY") : requireEnv("WORKOS_API_KEY");

const databaseUrl = process.env.SUPABASE_DB_URL ?? SUBSPACE_ENV.DATABASE_URL;
if (!databaseUrl) {
    console.error("no Supabase connection string: set SUPABASE_DB_URL, or SUBSPACE_ENV_FILE to an env file defining DATABASE_URL");
    process.exit(1);
}

async function main() {
    const client = createClient(apiKey);

    // Say out loud which tenant is about to be written to. The two keys are
    // interchangeable at the call site and only differ in consequence.
    console.log(`target=${PROD ? "PRODUCTION" : "staging"} key_prefix=${apiKey.slice(0, 8)} dry_run=${DRY_RUN}`);

    const db = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    await db.connect();
    const server = await db.query("select inet_server_addr()::text a, current_database() d");
    console.log(`source=${server.rows[0].a} db=${server.rows[0].d}`);

    const { rows } = await db.query(`
        select id, email, encrypted_password, email_confirmed_at,
               raw_user_meta_data, banned_until, deleted_at
        from auth.users
        order by created_at
    `);
    await db.end();
    console.log(`supabase_auth_users=${rows.length}`);

    const org = DRY_RUN
        ? { id: "(dry-run)", created: false }
        : await ensureOrganization(client, "Subspace");
    console.log(`organization=${org.id}${org.created ? " (created)" : ""}`);

    const tally = { created: 0, updated: 0, skipped: 0, failed: 0, memberships: 0 };
    const failures: unknown[] = [];

    for (const row of rows) {
        // Automated-test accounts do not belong in an identity provider. Skipped
        // here rather than only cleaned up afterwards, or every re-run would
        // resurrect what `clean-test-identities.ts` removed.
        const verdict = classifyIdentity(row.email);
        if (verdict.isTest) {
            tally.skipped++;
            console.log(`skipped test_identity ${row.email} (${verdict.reason})`);
            continue;
        }

        // An existing user may already be tagged for intervu. Read it first so
        // the tag merges instead of evicting them from the other product.
        const existing = DRY_RUN ? null : await findUserByEmail(client, (row.email ?? "").trim().toLowerCase());
        const payload = toWorkosUserPayload(row, existing?.metadata?.apps);

        if (!payload) {
            // Named, not silently dropped — a banned or deleted account
            // arriving as a working login would undo a decision someone made.
            tally.skipped++;
            const why = !row.email?.trim() ? "no_email" : row.deleted_at ? "deleted" : "banned";
            console.log(`skipped ${why} id=${row.id}`);
            continue;
        }

        if (DRY_RUN) {
            tally.created++;
            console.log(`would_sync ${payload.email} password=${payload.password_hash ? "bcrypt" : "none"}`);
            continue;
        }

        const outcome = await upsertUser(client, payload);
        if (outcome.action === "failed") {
            tally.failed++;
            failures.push({ email: payload.email, status: outcome.status, code: outcome.code });
            console.log(`FAILED ${payload.email} http=${outcome.status} code=${outcome.code}`);
            continue;
        }

        tally[outcome.action]++;
        const membership = await ensureMembership(client, outcome.id, org.id);
        if (membership === "added") tally.memberships++;
        console.log(`${outcome.action} ${payload.email} id=${outcome.id} membership=${membership}`);
    }

    console.log(`\nresult ${JSON.stringify(tally)}`);
    if (failures.length) {
        console.log(`failures ${JSON.stringify(failures)}`);
        process.exit(1);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
