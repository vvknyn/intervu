#!/usr/bin/env node
/**
 * ONE-SHOT MIGRATION SCRIPT — last piece of the Firebase Auth -> Supabase
 * Auth migration (phases 1-3 already landed: Supabase SSR foundation, the
 * identity-provider switch, and app-tagging for the shared `auth.users`
 * table — see app-tag.ts, user-directory.ts, ensure-app-membership.ts).
 * This provisions intervu's EXISTING Firebase Auth users into Supabase so a
 * returning user's sign-in resolves to the account already holding their
 * data, instead of landing on a brand-new empty one.
 *
 *   npx tsx scripts/provision-supabase-users.ts [--apply] [--include-password-users]
 *
 * DRY RUN BY DEFAULT. With no flags this changes NOTHING — it only prints
 * the plan. Writing requires `--apply`. Re-running is a no-op for anyone
 * already provisioned (idempotent, detected by email).
 *
 *   --apply                    perform the writes (default: dry run, no writes)
 *   --include-password-users   also provision non-Google accounts (see below);
 *                              created WITHOUT a password either way
 *
 * WHY EVERY USER MUST BE PRE-CREATED, NOT JUST LEFT TO SIGN IN COLD:
 *
 *  1. Every existing Firestore document is keyed by the user's original
 *     FIREBASE UID. The new Supabase row must carry that uid at
 *     `app_metadata.firebase_uid` so `resolveLegacyUid()` (app-tag.ts)
 *     keeps resolving to it. Skip this and a returning user signs in fine
 *     but finds an EMPTY account — their resumes and applications still
 *     exist, just keyed to an id nothing looks up any more.
 *
 *  2. `email_confirm` must be TRUE at creation. Supabase refuses to
 *     auto-link a Google identity onto an account whose email is
 *     unconfirmed — deliberately, because otherwise anyone could
 *     pre-register your address unconfirmed and capture your account the
 *     moment you signed in with Google. An unconfirmed pre-created row
 *     therefore does NOT link; the user gets a duplicate account or an
 *     error instead of landing back on their real one.
 *
 * SCOPE: by default only Google SSO accounts (`google.com` provider) are
 * provisioned. `--include-password-users` widens this to every other
 * account, created with NO password — see the "no lying fallback" / no
 * password rule below. Scope is decided by each Firebase user's own
 * provider list, never by a hardcoded email/domain list.
 *
 * THE CONFLICT CASE: a Firebase user's email may already exist in Supabase
 * because that person already has an account under the OTHER product
 * (subspace). This script NEVER overwrites `app_metadata` for such a row —
 * appending this app's slug to the existing `apps` array, preserving every
 * other key, is the only mutation it makes (see planUserProvisioning /
 * computeAppMembershipUpdate). If that existing account's email is
 * UNCONFIRMED, this is reported as a CONFLICT and left untouched entirely —
 * confirming someone's email is a security decision, not this script's call.
 *
 * NEVER A PASSWORD. No code path here sets, generates, or prints a
 * password, for anyone. An account that would otherwise need one is
 * created password-less; a human triggers a reset/magic link from the
 * Supabase dashboard afterward.
 *
 * REQUIRED ENV VARS (names only — this script never prints a value):
 *   NEXT_PUBLIC_SUPABASE_URL       Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY      Supabase service-role key (admin API)
 *   FIREBASE_SERVICE_ACCOUNT_KEY   Firebase service account JSON, OR:
 *     NEXT_PUBLIC_FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 *   (same precedence src/lib/firebase/admin.ts uses; this script builds its
 *   own Firebase Auth admin handle locally rather than resurrecting the
 *   `getAdminAuth()` export phase 3 deleted, which is Firestore-only now)
 *
 * NOTE: as of this writing, SUPABASE_SERVICE_ROLE_KEY is NOT present in
 * intervu's deployed environment. It must be added before this can run
 * anywhere but a local/dev shell that already has it.
 *
 * Exits non-zero if any write fails or a post-write verification mismatches
 * (see runProvisioning / applyPlanEntry in provision-plan.ts). A detected
 * CONFLICT does not by itself cause a non-zero exit — it is an expected,
 * correctly-classified finding for a human to act on outside this script,
 * not a script failure.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

import { APP_INTERVU } from "../src/lib/auth/app-tag";
import { getAdminClient } from "../src/lib/supabase/admin-client";
import {
    runProvisioning,
    type ProvisionPlanEntry,
    type RunProvisioningResult,
} from "../src/lib/auth/provision-plan";

const here = dirname(fileURLToPath(import.meta.url));

// Env must land before firebase-admin/@supabase clients read it. Manual
// .env.local read — same convention scripts/firestore-export.ts and
// scripts/digest-dry-run.mts use (no dotenv dependency in this repo).
try {
    for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
} catch {
    /* no .env.local — fine if the real env already has what's needed */
}

function assertEnv(): void {
    const missing: string[] = [];
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");

    const hasServiceAccountJson = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim());
    const hasIndividualFirebaseVars =
        Boolean(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()) &&
        Boolean(process.env.FIREBASE_CLIENT_EMAIL?.trim()) &&
        Boolean(process.env.FIREBASE_PRIVATE_KEY?.trim());
    if (!hasServiceAccountJson && !hasIndividualFirebaseVars) {
        missing.push(
            "FIREBASE_SERVICE_ACCOUNT_KEY (or NEXT_PUBLIC_FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)",
        );
    }

    if (missing.length > 0) {
        console.error("Missing required env var(s):");
        for (const name of missing) console.error(`  - ${name}`);
        console.error("\nSee this script's header comment for what each one is for.");
        process.exit(1);
    }
}

/** Builds a local Firebase Admin App for Auth only. Mirrors
 *  src/lib/firebase/admin.ts's own credential precedence exactly, but does
 *  not import from it — that module has no exported way to get the App
 *  itself (only `getAdminDb()`, a Firestore handle), and `getAdminAuth()`
 *  was deliberately deleted in phase 3. Reuses any app already initialized
 *  in this process (e.g. by another module) rather than double-initializing. */
function getFirebaseAdminApp(): App {
    if (getApps().length > 0) return getApps()[0];
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (serviceAccount) {
        return initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
    }
    return initializeApp({
        credential: cert({
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
    });
}

function describeEntry(entry: ProvisionPlanEntry): string {
    return `[${entry.action}] uid=${entry.firebaseUid} email=${entry.email}\n    reason: ${entry.reason}`;
}

function printReport(result: RunProvisioningResult, apply: boolean): void {
    const byAction = (action: ProvisionPlanEntry["action"]) => result.rows.filter((r) => r.entry.action === action);

    console.log(`\nFirebase users considered: ${result.rows.length + result.outOfScopeCount}`);
    console.log(`  in scope: ${result.rows.length}   out of scope (password-only, no --include-password-users): ${result.outOfScopeCount}`);

    console.log(`\n=== PLAN ===`);
    for (const row of result.rows) {
        console.log(describeEntry(row.entry));
        if (row.outcome?.status === "failed") console.log(`    FAILED: ${row.outcome.error}`);
    }

    const conflicts = byAction("CONFLICT_UNCONFIRMED_EMAIL");
    if (conflicts.length > 0) {
        console.log(`\n=== CONFLICTS REQUIRING HUMAN REVIEW (${conflicts.length}) ===`);
        for (const row of conflicts) console.log(describeEntry(row.entry));
    }

    console.log(`\n=== SUMMARY ===`);
    if (!apply) {
        console.log(
            `would create: ${byAction("CREATE").length}   ` +
                `would append: ${byAction("APPEND_APP").length}   ` +
                `already provisioned: ${byAction("SKIP_ALREADY_PROVISIONED").length}   ` +
                `conflicts: ${conflicts.length}`,
        );
        console.log(`DRY RUN — nothing was written. Re-run with --apply to write.`);
    } else {
        console.log(
            `created: ${result.created}   appended: ${result.appended}   ` +
                `skipped: ${result.skipped}   conflicts: ${result.conflicts}   failed: ${result.failed}`,
        );
    }
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const includePasswordUsers = process.argv.includes("--include-password-users");

    assertEnv();

    const firebaseAuth = getAuth(getFirebaseAdminApp());
    const supabase = getAdminClient();

    const result = await runProvisioning(firebaseAuth, supabase, {
        app: APP_INTERVU,
        includePasswordUsers,
        apply,
    });

    printReport(result, apply);

    if (result.failed > 0) {
        console.error(`\n${result.failed} write(s) failed or failed post-write verification.`);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
