import { test } from "node:test";
import assert from "node:assert/strict";
import { toServerUser } from "../../src/lib/auth/workos-identity";

/**
 * `uid` is the only field here that can lose someone their data. Firestore keys
 * every document by it, so if a migrated user comes back through WorkOS and
 * this resolver hands back the WorkOS id instead of their Firebase uid, they
 * sign in successfully and find an empty account — the worst kind of failure,
 * because nothing errors.
 */
test("a migrated user keeps their Firebase uid", () => {
  assert.equal(
    toServerUser({
      id: "user_01M0V03H1569611SRYC45K1DFJ",
      externalId: "MR3iXRtIpANFdTrzMosBfOMl4lU2",
      email: "ada@example.com",
    }).uid,
    "MR3iXRtIpANFdTrzMosBfOMl4lU2",
  );
});

test("a user created after the cutover falls back to the WorkOS id", () => {
  // Not a migrated account, so there is no Firebase uid to preserve and the
  // WorkOS id becomes the permanent key.
  assert.equal(
    toServerUser({ id: "user_NEW", email: "new@example.com" }).uid,
    "user_NEW",
  );
  assert.equal(
    toServerUser({ id: "user_NEW", externalId: null }).uid,
    "user_NEW",
  );
  // An empty string is not an id. Returning it would key every such user's
  // documents under "", silently pooling them together.
  assert.equal(
    toServerUser({ id: "user_NEW", externalId: "" }).uid,
    "user_NEW",
  );
});

test("displayName is composed, and absent rather than blank", () => {
  assert.equal(
    toServerUser({ id: "u", firstName: "Ada", lastName: "Lovelace" })
      .displayName,
    "Ada Lovelace",
  );
  assert.equal(toServerUser({ id: "u", firstName: "Ada" }).displayName, "Ada");
  assert.equal(
    toServerUser({ id: "u", lastName: "Lovelace" }).displayName,
    "Lovelace",
  );
  // A blank string would render as an empty name in the UI where a fallback
  // ("your account") is wanted instead.
  assert.equal(toServerUser({ id: "u" }).displayName, undefined);
  assert.equal(
    toServerUser({ id: "u", firstName: "", lastName: "" }).displayName,
    undefined,
  );
});

test("a missing email is undefined, never null", () => {
  // The contract callers were written against is optional-string; handing them
  // null puts a `null` into template literals as the text "null".
  assert.equal(toServerUser({ id: "u", email: null }).email, undefined);
  assert.equal(toServerUser({ id: "u" }).email, undefined);
  assert.equal(toServerUser({ id: "u", email: "a@b.com" }).email, "a@b.com");
});
