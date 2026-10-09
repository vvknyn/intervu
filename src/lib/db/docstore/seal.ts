/**
 * Encryption for the account-data store (pg-docstore.ts).
 *
 * Every document is sealed with AES-256-GCM before it reaches Postgres, so
 * the database, its WAL-G backups in B2 and anyone who can read either see
 * ciphertext. The key is DATA_ENCRYPTION_KEY (64 hex chars = 32 bytes), held
 * only in the web box's env file and in Vivek's own off-box copy. Losing it
 * makes every sealed row unreadable, which is the point: a stolen dump or
 * backup without the key is useless.
 *
 * Two keys are derived from it with HKDF so one secret never does two jobs:
 *  - the SEAL key encrypts whole documents;
 *  - the LOOKUP key makes keyed hashes (HMAC-SHA256) of the few personal
 *    values the app has to look rows up by (an email on the unsubscribe
 *    list, a username at sign-in). A keyed hash answers "is this the same
 *    value" without storing the value, and can't be reversed or guessed
 *    without the key.
 *
 * The sealed form is bound to the row it was written for (the stored path is
 * the AES-GCM additional data), so a sealed blob copied onto another row
 * fails to open rather than silently impersonating that row's document.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "crypto";

const SEAL_PREFIX = "v1.";
const LOOKUP_PREFIX = "h1.";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface DocKeys {
    seal: Buffer;
    lookup: Buffer;
}

/** Derives both working keys from a 32-byte root key given as 64 hex chars. */
export function deriveDocKeys(rootHex: string): DocKeys {
    if (!/^[0-9a-fA-F]{64}$/.test(rootHex)) {
        throw new Error("DATA_ENCRYPTION_KEY must be 64 hex characters (32 bytes); generate one with `openssl rand -hex 32`");
    }
    const root = Buffer.from(rootHex, "hex");
    const derive = (info: string) => Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), info, 32));
    return { seal: derive("velai/docstore/seal/v1"), lookup: derive("velai/docstore/lookup/v1") };
}

let envKeys: DocKeys | null = null;

/** The keys from DATA_ENCRYPTION_KEY. Throws when it is missing: the store
 *  must never fall back to writing plain text. */
export function docKeysFromEnv(): DocKeys {
    if (envKeys) return envKeys;
    const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
    if (!raw) {
        throw new Error("DATA_ENCRYPTION_KEY is not set: refusing to read or write account data without it");
    }
    envKeys = deriveDocKeys(raw);
    return envKeys;
}

/** Encrypts `value` (any JSON value) for the row stored at `boundTo`. */
export function seal(keys: DocKeys, boundTo: string, value: unknown): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", keys.seal, iv);
    cipher.setAAD(Buffer.from(boundTo, "utf8"));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return SEAL_PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** Opens a value sealed for the row at `boundTo`. Throws on a wrong key,
 *  tampered bytes, or a blob that was sealed for a different row. */
export function open(keys: DocKeys, boundTo: string, sealed: string): unknown {
    if (!sealed.startsWith(SEAL_PREFIX)) throw new Error(`unrecognised sealed format at ${boundTo}`);
    const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), "base64url");
    if (raw.length < IV_BYTES + TAG_BYTES) throw new Error(`sealed value too short at ${boundTo}`);
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", keys.seal, iv);
    decipher.setAAD(Buffer.from(boundTo, "utf8"));
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    return JSON.parse(text);
}

/** A keyed hash of a lookup value. Equal inputs give equal outputs, so a
 *  stored hash can be matched with `=`, but the value can't be recovered.
 *  Typed (JSON-encoded) so the string "1" and the number 1 stay distinct,
 *  as they are to Firestore's `==`. */
export function lookupHash(keys: DocKeys, value: unknown): string {
    return LOOKUP_PREFIX + createHmac("sha256", keys.lookup).update(JSON.stringify(value)).digest("base64url");
}

export function isSealed(value: unknown): value is string {
    return typeof value === "string" && value.startsWith(SEAL_PREFIX);
}
