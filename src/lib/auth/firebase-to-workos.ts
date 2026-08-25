/**
 * Firebase Auth → WorkOS user mapping.
 *
 * Pure functions only: no network, no SDK handles, no env reads — the runner
 * (`scripts/migrate-firebase-to-workos.mjs`) owns all of that. Everything here
 * is the part that is easy to get silently wrong, so it is the part that has
 * tests.
 *
 * Two things this file exists to guarantee:
 *
 * 1. **Identity survives the move.** Every Firestore document is keyed by the
 *    Firebase uid (`profiles`, `applications`, `tailored_resumes`, ... all
 *    carry `user_id`). If WorkOS minted fresh ids and nothing carried the old
 *    one, every one of those documents would orphan. The uid therefore travels
 *    as `external_id` — a first-class, queryable WorkOS field — and again in
 *    `metadata.firebase_uid` so a human reading the dashboard can see it.
 *
 * 2. **Passwords keep working.** Firebase hashes with a modified scrypt whose
 *    parameters live on the PROJECT, not the user. WorkOS accepts them as
 *    `firebase-scrypt` if the hash is given in PHC form.
 */

import { APP_INTERVU, mergeApps } from "./workos-apps";

/** Project-level scrypt parameters, from the Identity Toolkit admin config. */
export interface FirebaseHashConfig {
  /** Base64. The secret that makes every per-user hash verifiable. */
  signerKey: string;
  /** Base64, typically "Bw==". */
  saltSeparator: string;
  rounds: number;
  memoryCost: number;
}

/** The subset of a Firebase UserRecord this mapping reads. */
export interface FirebaseUserLike {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  photoURL?: string;
  disabled?: boolean;
  /** Base64URL from the Admin SDK — see `decodeBase64Any`. */
  passwordHash?: string;
  /** Base64URL from the Admin SDK. */
  passwordSalt?: string;
}

export interface WorkosUserPayload {
  email: string;
  email_verified: boolean;
  first_name?: string;
  last_name?: string;
  external_id: string;
  metadata: Record<string, string>;
  password_hash?: string;
  password_hash_type?: "firebase-scrypt";
}

/**
 * Decode base64 in EITHER alphabet.
 *
 * This is the whole reason the first import attempt failed 9 of 9 with
 * `invalid_password_hash`. The Admin SDK's `passwordHash`/`passwordSalt` use
 * the URL alphabet (`-`, `_`); the admin config API's `signerKey` uses the
 * standard one (`+`, `/`). Both are 88 characters and both are called
 * "base64", so nothing in a type signature distinguishes them — and only 2 of
 * 64 characters differ, so a given value may look identical under both.
 *
 * Normalising at the BYTE layer removes the distinction. Manipulating the
 * base64 TEXT (stripping padding, slicing) preserves it, which is exactly how
 * the bad string got built.
 */
export function decodeBase64Any(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * PHC string, per WorkOS's Firebase migration guide:
 *
 *   $firebase-scrypt$v=1$r=<rounds>,m=<mem>,ss=<saltSep>,sk=<signerKey>$<salt>$<hash>
 *
 * Every binary field is base64 in the STANDARD alphabet with `=` padding
 * removed (PHC forbids the padding character). Param order is significant to
 * readers of the format and matches the guide.
 */
export function buildFirebaseScryptHash(
  user: Pick<FirebaseUserLike, "passwordHash" | "passwordSalt">,
  config: FirebaseHashConfig,
): string | null {
  if (!user.passwordHash || !user.passwordSalt) return null;

  const b64 = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "");
  const params = [
    `r=${config.rounds}`,
    `m=${config.memoryCost}`,
    `ss=${b64(decodeBase64Any(config.saltSeparator))}`,
    `sk=${b64(decodeBase64Any(config.signerKey))}`,
  ].join(",");

  return [
    "",
    "firebase-scrypt",
    "v=1",
    params,
    b64(decodeBase64Any(user.passwordSalt)),
    b64(decodeBase64Any(user.passwordHash)),
  ].join("$");
}

/**
 * Split a Firebase `displayName` into first/last.
 *
 * Everything after the first space is the last name, so multi-word family
 * names ("Ada Lovelace King") stay intact rather than losing their tail. A
 * single-token name is a first name — guessing a surname would be inventing
 * data about a person.
 */
export function splitDisplayName(displayName?: string): {
  first?: string;
  last?: string;
} {
  const trimmed = (displayName ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return {};
  const cut = trimmed.indexOf(" ");
  if (cut === -1) return { first: trimmed };
  return { first: trimmed.slice(0, cut), last: trimmed.slice(cut + 1) };
}

/**
 * Map one Firebase user to a WorkOS create-user payload.
 *
 * Returns `null` for a user that must not be created — currently only one
 * case: no email address. WorkOS identifies users by email, so an
 * email-less Firebase record has nothing to become. Callers report these
 * rather than dropping them silently.
 *
 * A user with no password is NOT skipped: the nine Google-only accounts have
 * no hash and are supposed to sign in through Google, so they are created
 * without credentials rather than held back.
 */
export function toWorkosUserPayload(
  user: FirebaseUserLike,
  config: FirebaseHashConfig,
  existingApps?: string,
): WorkosUserPayload | null {
  if (!user.email) return null;

  const { first, last } = splitDisplayName(user.displayName);
  const passwordHash = buildFirebaseScryptHash(
    { passwordHash: user.passwordHash, passwordSalt: user.passwordSalt },
    config,
  );

  const metadata: Record<string, string> = {
    firebase_uid: user.uid,
    // Merged, not assigned: someone with accounts in both products is ONE
    // WorkOS user, and whichever migration runs second must not evict them
    // from the other. See `workos-apps.ts`.
    apps: mergeApps(existingApps, APP_INTERVU),
  };
  if (user.photoURL) metadata.photo_url = user.photoURL;

  return {
    email: user.email.trim().toLowerCase(),
    email_verified: Boolean(user.emailVerified),
    ...(first ? { first_name: first } : {}),
    ...(last ? { last_name: last } : {}),
    external_id: user.uid,
    metadata,
    ...(passwordHash
      ? {
          password_hash: passwordHash,
          password_hash_type: "firebase-scrypt" as const,
        }
      : {}),
  };
}
