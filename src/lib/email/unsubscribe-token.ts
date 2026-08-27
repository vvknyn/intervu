/**
 * Signed, stateless unsubscribe tokens — no login, no database round trip
 * to prove intent. HMAC-SHA256 over `email:kind` using the SAME key
 * material `lib/encryption.ts` already uses for API-key-at-rest encryption
 * (`getEncryptionKey`, exported for exactly this reuse) rather than minting
 * a second server secret. Deliberately no expiry: an unsubscribe link in a
 * six-month-old email must still work — CASL/CAN-SPAM don't give it a
 * shelf life, and a token that stopped working would silently regress
 * deliverability protection for old sends.
 *
 * Pure — no I/O, no Firestore — so tamper/mismatch handling is directly
 * unit-testable.
 *
 * KNOWN KEY-REUSE TRADE-OFF: the HMAC signing key below is the same raw
 * `ENCRYPTION_KEY` bytes used for AES-256-GCM encryption in lib/encryption.ts
 * — general key-hygiene practice is to use a separate key per cryptographic
 * primitive (e.g. HKDF-derive a distinct signing key from the same master).
 * This is deliberately NOT done here: tokens are permanent by design (see
 * "no expiry" above), so switching the signing key would invalidate every
 * unsubscribe link already sent in every past email — a CASL/CAN-SPAM
 * deliverability regression, not just a bug. If `ENCRYPTION_KEY` ever
 * rotates for its AES use, mint a dedicated `UNSUBSCRIBE_SIGNING_KEY` at
 * that point rather than reusing the new AES key blind.
 */
import crypto from "crypto";
import { getEncryptionKey } from "@/lib/encryption";
import { normalizeEmail } from "./normalize-email";
import type { EmailKind } from "./types";

/** A token's scope: one specific kind, or "all" (the "unsubscribe from
 *  everything" link every non-transactional footer also carries). */
export type UnsubscribeScope = EmailKind | "all";

export interface UnsubscribeTokenPayload {
  email: string;
  kind: UnsubscribeScope;
}

function hmacDigest(key: Buffer, data: string): string {
  return crypto.createHmac("sha256", key).update(data).digest("base64url");
}

/**
 * Returns null (never throws) when `ENCRYPTION_KEY` is unset — same
 * no-key-no-op posture as the rest of the email seam. A caller with no key
 * has no way to produce a verifiable link, so it must not emit one.
 */
export function signUnsubscribeToken(email: string, kind: UnsubscribeScope): string | null {
  const key = getEncryptionKey();
  if (!key) return null;

  const encoded = Buffer.from(`${normalizeEmail(email)}:${kind}`, "utf8").toString("base64url");
  return `${encoded}.${hmacDigest(key, encoded)}`;
}

/**
 * Verifies signature + shape. `expectedKind`, when passed, additionally
 * rejects a structurally valid token signed for a DIFFERENT kind (e.g. a
 * caller that only ever wants to accept "digest" tokens) — the signature
 * alone can't catch this since the kind lives inside the signed payload
 * and would verify fine on its own.
 */
export function verifyUnsubscribeToken(
  token: string,
  expectedKind?: UnsubscribeScope,
): UnsubscribeTokenPayload | null {
  const key = getEncryptionKey();
  if (!key) return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expectedSignature = hmacDigest(key, encoded);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const separatorIndex = decoded.lastIndexOf(":");
  if (separatorIndex === -1) return null;

  const email = decoded.slice(0, separatorIndex);
  const kind = decoded.slice(separatorIndex + 1) as UnsubscribeScope;
  if (!email || !kind) return null;
  if (expectedKind && kind !== expectedKind) return null;

  return { email, kind };
}
