#!/usr/bin/env node
/**
 * Migrate Firebase Auth users into WorkOS User Management.
 *
 *   npx tsx scripts/migrate-firebase-to-workos.ts --dry-run   # report only
 *   npx tsx scripts/migrate-firebase-to-workos.ts             # create/update
 *   npx tsx scripts/migrate-firebase-to-workos.ts --prod      # target production
 *
 * These are intervu's users: each is placed in the **Intervu** organization and
 * tagged `metadata.apps=intervu`, which is what keeps them distinguishable from
 * subspace's users now that one WorkOS environment serves both products.
 *
 * Run under tsx, not bare node: the mapping it imports is TypeScript, and it
 * is TypeScript because that is what the unit tests exercise.
 *
 * Idempotent: a user that already exists in WorkOS (matched by email) is
 * updated rather than duplicated, so a partial run can simply be re-run. That
 * matters more than it sounds — the first attempt at this migration half
 * succeeded, and without idempotency the only recovery is deleting accounts.
 *
 * Reads Firebase live rather than a dumped file: an export goes stale the
 * moment someone signs up, and the whole point is that nobody is left behind.
 *
 * Secrets: the scrypt signer key and the per-user password hashes are read
 * into memory and sent to WorkOS over TLS. They are never logged, never
 * written to disk, and never placed in argv.
 */
import { config } from "dotenv";
import admin from "firebase-admin";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { toWorkosUserPayload } from "../src/lib/auth/firebase-to-workos.ts";
import {
  createClient,
  ensureMembership,
  ensureOrganization,
  findUserByEmail,
  upsertUser,
} from "./workos-sync.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const PROD = process.argv.includes("--prod");
// Production is opt-in and uses a SEPARATE variable, so a normal run can never
// reach it by accident and local dev never has to point at the live tenant.
const WORKOS_KEY = PROD
  ? requireEnv("WORKOS_PROD_API_KEY")
  : requireEnv("WORKOS_API_KEY");

function requireEnv(name) {
  const value = process.env[name];
  // Fail loudly on a missing credential. A migration that silently skips
  // users because a key was absent is indistinguishable from one that had
  // nothing to do.
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

// --- Firebase ------------------------------------------------------------

const projectId = requireEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
const credential = admin.credential.cert({
  projectId,
  clientEmail: requireEnv("FIREBASE_CLIENT_EMAIL"),
  privateKey: requireEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
});
admin.initializeApp({ credential });

/**
 * Project-level scrypt parameters. These are NOT on the user record — a
 * per-user hash without them is unverifiable, so this is the gate on the
 * entire password path.
 */
async function fetchHashConfig() {
  const { access_token: token } = await credential.getAccessToken();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`identitytoolkit config http ${res.status}`);
  const hashConfig = (await res.json())?.signIn?.hashConfig;
  if (!hashConfig?.signerKey)
    throw new Error("project hashConfig missing signerKey");
  return hashConfig;
}

async function listFirebaseUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

// --- Run -----------------------------------------------------------------

async function main() {
  const client = createClient(WORKOS_KEY);

  // Say out loud which tenant is about to be written to. The two keys are
  // interchangeable at the call site and differ only in consequence.
  console.log(
    `target=${PROD ? "PRODUCTION" : "staging"} key_prefix=${WORKOS_KEY.slice(0, 8)} dry_run=${DRY_RUN}`,
  );

  const hashConfig = await fetchHashConfig();
  const firebaseUsers = await listFirebaseUsers();
  console.log(`firebase_users=${firebaseUsers.length}`);

  const org = DRY_RUN
    ? { id: "(dry-run)", created: false }
    : await ensureOrganization(client, "Intervu");
  console.log(`organization=${org.id}${org.created ? " (created)" : ""}`);

  const tally = { created: 0, updated: 0, no_email: 0, failed: 0, memberships: 0 };
  const failures = [];

  for (const user of firebaseUsers) {
    // Read the existing record first so the `apps` tag merges rather than
    // replacing — a user of both products must keep both.
    const existing = DRY_RUN
      ? null
      : await findUserByEmail(client, (user.email ?? "").trim().toLowerCase());

    const payload = toWorkosUserPayload(
      {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        displayName: user.displayName,
        photoURL: user.photoURL,
        disabled: user.disabled,
        passwordHash: user.passwordHash,
        passwordSalt: user.passwordSalt,
      },
      hashConfig,
      existing?.metadata?.apps,
    );

    if (!payload) {
      // Named, not silently dropped: a user with no email has no WorkOS
      // identity to become, and someone has to decide what happens to them.
      tally.no_email++;
      console.log(`no_email uid=${user.uid}`);
      continue;
    }

    if (DRY_RUN) {
      tally.created++;
      console.log(
        `would_sync ${payload.email} password=${payload.password_hash ? "yes" : "no"}`,
      );
      continue;
    }

    const outcome = await upsertUser(client, payload);
    if (outcome.action === "failed") {
      tally.failed++;
      failures.push({
        email: payload.email,
        status: outcome.status,
        code: outcome.code,
      });
      console.log(
        `FAILED ${payload.email} http=${outcome.status} code=${outcome.code}`,
      );
      continue;
    }

    tally[outcome.action]++;
    const membership = await ensureMembership(client, outcome.id, org.id);
    if (membership === "added") tally.memberships++;
    console.log(
      `${outcome.action} ${payload.email} id=${outcome.id} membership=${membership}`,
    );
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
