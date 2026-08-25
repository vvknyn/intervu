import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayNameFrom,
  isBcryptHash,
  toWorkosUserPayload,
} from "../../src/lib/auth/supabase-to-workos";

// A structurally valid bcrypt hash: $2<variant>$<2-digit cost>$<53 chars>.
const BCRYPT = `$2a$10$${"a".repeat(53)}`;

test("isBcryptHash accepts the real variants and rejects near-misses", () => {
  assert.equal(isBcryptHash(BCRYPT), true);
  assert.equal(isBcryptHash(`$2b$12$${"b".repeat(53)}`), true);
  assert.equal(isBcryptHash(`$2y$04$${"c".repeat(53)}`), true);

  // The near-misses matter more than the hits. Declaring any of these as
  // `bcrypt` would import cleanly and then reject the user's password at
  // sign-in — a silent lockout, not an error.
  assert.equal(isBcryptHash(`$2a$10$${"a".repeat(52)}`), false, "too short");
  assert.equal(isBcryptHash(`$2a$10$${"a".repeat(54)}`), false, "too long");
  assert.equal(isBcryptHash(`$2c$10$${"a".repeat(53)}`), false, "unknown variant");
  assert.equal(isBcryptHash(`$2a$1$${"a".repeat(53)}`), false, "one-digit cost");
  assert.equal(isBcryptHash("$firebase-scrypt$v=1$r=8,m=14,ss=Bw,sk=x$salt$hash"), false);
  assert.equal(isBcryptHash(""), false);
  assert.equal(isBcryptHash(null), false);
  assert.equal(isBcryptHash(undefined), false);
});

test("displayNameFrom prefers a human name over a handle", () => {
  assert.equal(displayNameFrom({ full_name: "Ada Lovelace", username: "ada99" }), "Ada Lovelace");
  assert.equal(displayNameFrom({ name: "Ada Lovelace", username: "ada99" }), "Ada Lovelace");
  // `username` is a last resort — it is a handle, not a name.
  assert.equal(displayNameFrom({ username: "ada99" }), "ada99");
  assert.equal(displayNameFrom({ email_verified: true }), undefined);
  assert.equal(displayNameFrom(null), undefined);
  assert.equal(displayNameFrom({ full_name: "   " }), undefined, "blank is not a name");
  assert.equal(displayNameFrom({ full_name: "Ada   Lovelace" }), "Ada Lovelace");
  assert.equal(displayNameFrom({ full_name: 42 as unknown as string }), undefined, "non-string");
});

test("a Supabase user carries its uuid as external_id and is tagged subspace", () => {
  const payload = toWorkosUserPayload({
    id: "3f1c9a2e-0000-4000-8000-abcdefabcdef",
    email: "  Ada@Example.COM ",
    encrypted_password: BCRYPT,
    email_confirmed_at: new Date(),
    raw_user_meta_data: { full_name: "Ada Lovelace" },
  })!;

  assert.equal(payload.external_id, "3f1c9a2e-0000-4000-8000-abcdefabcdef");
  assert.equal(payload.metadata.supabase_uid, "3f1c9a2e-0000-4000-8000-abcdefabcdef");
  assert.equal(payload.metadata.apps, "subspace");
  assert.equal(payload.email, "ada@example.com");
  assert.equal(payload.email_verified, true);
  assert.equal(payload.first_name, "Ada");
  assert.equal(payload.last_name, "Lovelace");
  assert.equal(payload.password_hash, BCRYPT, "bcrypt passes through untouched");
  assert.equal(payload.password_hash_type, "bcrypt");
});

test("a user already known to intervu keeps both tags", () => {
  // The overlap case. Replacing the tag would evict them from intervu.
  const payload = toWorkosUserPayload(
    { id: "uuid-1", email: "both@example.com", encrypted_password: BCRYPT },
    "intervu",
  )!;
  assert.equal(payload.metadata.apps, "intervu,subspace");
});

test("an unusable password is dropped, not mislabelled", () => {
  // Five of the 35 rows have no password at all (OAuth). Shipping a bad or
  // absent hash under `bcrypt` is what turns "sign in with Google" into
  // "your password is wrong".
  const noPassword = toWorkosUserPayload({ id: "u", email: "a@b.com" })!;
  assert.equal(noPassword.password_hash, undefined);
  assert.equal(noPassword.password_hash_type, undefined);
  assert.equal(noPassword.external_id, "u", "still a real identity");

  const garbage = toWorkosUserPayload({ id: "u", email: "a@b.com", encrypted_password: "not-a-hash" })!;
  assert.equal(garbage.password_hash, undefined);
  assert.equal(garbage.password_hash_type, undefined);
});

test("rows that must not become identities are refused", () => {
  assert.equal(toWorkosUserPayload({ id: "u" }), null, "no email");
  assert.equal(toWorkosUserPayload({ id: "u", email: "   " }), null, "blank email");
  // A banned account arriving as a working login would undo a moderation
  // decision; a deleted one would resurrect a closed account.
  assert.equal(
    toWorkosUserPayload({ id: "u", email: "a@b.com", banned_until: new Date() }),
    null,
    "banned",
  );
  assert.equal(
    toWorkosUserPayload({ id: "u", email: "a@b.com", deleted_at: new Date() }),
    null,
    "soft-deleted",
  );
});

test("an unconfirmed email is carried as unverified, not invented", () => {
  const payload = toWorkosUserPayload({ id: "u", email: "a@b.com", email_confirmed_at: null })!;
  assert.equal(payload.email_verified, false);
});
