#!/usr/bin/env node
/**
 * Migrate Firebase Auth users into WorkOS User Management.
 *
 *   npx tsx scripts/migrate-firebase-to-workos.ts --dry-run   # report only
 *   npx tsx scripts/migrate-firebase-to-workos.ts             # create/update
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const WORKOS_KEY = requireEnv("WORKOS_API_KEY");

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

// --- WorkOS --------------------------------------------------------------

async function workos(path, init = {}) {
  const res = await fetch(`https://api.workos.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${WORKOS_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function findByEmail(email) {
  const res = await workos(
    `/user_management/users?email=${encodeURIComponent(email)}&limit=1`,
  );
  return res.ok ? (res.body.data?.[0] ?? null) : null;
}

// --- Run -----------------------------------------------------------------

async function main() {
  const hashConfig = await fetchHashConfig();
  const firebaseUsers = await listFirebaseUsers();
  console.log(`firebase_users=${firebaseUsers.length} dry_run=${DRY_RUN}`);

  const tally = {
    created: 0,
    updated: 0,
    unchanged: 0,
    no_email: 0,
    failed: 0,
  };
  const failures = [];

  for (const user of firebaseUsers) {
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
    );

    if (!payload) {
      // Named, not silently dropped: a user with no email has no WorkOS
      // identity to become, and someone has to decide what happens to them.
      tally.no_email++;
      console.log(`no_email uid=${user.uid}`);
      continue;
    }

    const existing = await findByEmail(payload.email);

    if (DRY_RUN) {
      console.log(
        `${existing ? "would_update" : "would_create"} ${payload.email}` +
          ` password=${payload.password_hash ? "yes" : "no"}`,
      );
      tally[existing ? "updated" : "created"]++;
      continue;
    }

    if (existing) {
      // Re-running must converge, not duplicate. The update carries
      // external_id and metadata so a half-finished earlier run is repaired;
      // the password hash is only sent when we have one, so an existing
      // credential is never blanked.
      const { password_hash, password_hash_type, email, ...rest } = payload;
      const res = await workos(`/user_management/users/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify(rest),
      });
      if (res.ok) {
        tally.updated++;
        console.log(`updated ${payload.email} id=${existing.id}`);
      } else {
        tally.failed++;
        failures.push({
          email: payload.email,
          status: res.status,
          code: res.body?.code,
        });
        console.log(
          `FAILED update ${payload.email} http=${res.status} code=${res.body?.code}`,
        );
      }
      continue;
    }

    const res = await workos("/user_management/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      tally.created++;
      console.log(
        `created ${payload.email} id=${res.body.id} external_id=${res.body.external_id}`,
      );
    } else {
      tally.failed++;
      failures.push({
        email: payload.email,
        status: res.status,
        code: res.body?.code,
      });
      console.log(
        `FAILED create ${payload.email} http=${res.status} code=${res.body?.code}`,
      );
    }
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
