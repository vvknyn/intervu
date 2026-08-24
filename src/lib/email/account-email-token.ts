/**
 * Signed, stateless tokens for "confirm this address belongs to you, then
 * attach it to this account".
 *
 * Same HMAC-SHA256-over-base64url idiom as `unsubscribe-token.ts`, over the
 * same `getEncryptionKey()` material, for the same reason: no second server
 * secret, and no database round trip to prove intent.
 *
 * It differs from that module in ONE way, deliberately: these tokens expire.
 * An unsubscribe link must work forever — a six-month-old email's opt-out is
 * still an opt-out, and expiring it would silently regress deliverability
 * compliance. This link does the opposite of opting out: it WRITES an
 * identity onto an account, so a link that leaks (a forwarded mail, a shared
 * screenshot, a mailbox someone later loses control of) must stop being a
 * key. Bound to the uid as well as the address, so a token minted for one
 * account can never attach its address to another.
 *
 * Pure — no I/O, no Firestore, no Firebase Admin — so tamper, expiry and
 * mismatch handling are all directly unit-testable.
 */
import crypto from "crypto";
import { getEncryptionKey } from "@/lib/encryption";
import { normalizeEmail } from "./normalize-email";

/** How long a confirmation link stays usable. Long enough to survive a
 *  "I'll do it tonight", short enough that an old forwarded mail is inert. */
export const ACCOUNT_EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface AccountEmailClaim {
    uid: string;
    email: string;
}

function hmacDigest(key: Buffer, data: string): string {
    return crypto.createHmac("sha256", key).update(data).digest("base64url");
}

/**
 * Returns null (never throws) when `ENCRYPTION_KEY` is unset — the same
 * no-key-no-op posture as the rest of the email seam. A caller with no key
 * cannot produce a verifiable link, so it must not emit one at all rather
 * than emit one that will fail to verify later.
 */
export function signAccountEmailToken(uid: string, email: string, issuedAtMs: number): string | null {
    const key = getEncryptionKey();
    if (!key) return null;
    if (!uid || !email) return null;

    const encoded = Buffer.from(
        `${uid}:${normalizeEmail(email)}:${issuedAtMs}`,
        "utf8",
    ).toString("base64url");
    return `${encoded}.${hmacDigest(key, encoded)}`;
}

/**
 * Null for every failure mode — no key, malformed, tampered, expired — and
 * deliberately WITHOUT telling the caller which. The route's answer to a bad
 * token is the same either way, and distinguishing "wrong signature" from
 * "expired" to an unauthenticated caller is free information about the token
 * format. (`verifyUnsubscribeToken` makes the same call.)
 */
export function verifyAccountEmailToken(
    token: string | null | undefined,
    nowMs: number,
): AccountEmailClaim | null {
    const key = getEncryptionKey();
    if (!key || !token) return null;

    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const encoded = token.slice(0, dot);
    const signature = token.slice(dot + 1);

    const expected = hmacDigest(key, encoded);
    // Length check first: `timingSafeEqual` THROWS on a length mismatch
    // rather than returning false, so an attacker-controlled length would
    // otherwise turn into a 500 instead of a clean rejection.
    if (signature.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

    let decoded: string;
    try {
        decoded = Buffer.from(encoded, "base64url").toString("utf8");
    } catch {
        return null;
    }

    // Split from the RIGHT: the issued-at and the email are unambiguous, but
    // a uid is opaque and a colon inside it must not shift the fields.
    const lastColon = decoded.lastIndexOf(":");
    if (lastColon < 0) return null;
    const issuedAtMs = Number(decoded.slice(lastColon + 1));
    const rest = decoded.slice(0, lastColon);
    const emailColon = rest.lastIndexOf(":");
    if (emailColon <= 0) return null;

    const uid = rest.slice(0, emailColon);
    const email = rest.slice(emailColon + 1);
    if (!uid || !email) return null;
    if (!Number.isFinite(issuedAtMs)) return null;
    // A future-dated token is as broken as an expired one — it means the
    // payload was edited, since we are the only minter.
    if (issuedAtMs > nowMs) return null;
    if (nowMs - issuedAtMs > ACCOUNT_EMAIL_TOKEN_TTL_MS) return null;

    return { uid, email };
}
