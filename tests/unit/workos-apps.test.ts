import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APP_INTERVU,
  APP_SUBSPACE,
  buildUpdatePayload,
  hasApp,
  mergeApps,
  parseApps,
} from "../../src/lib/auth/workos-apps";

test("parseApps tolerates the shapes a hand-edited tag arrives in", () => {
  assert.deepEqual(parseApps("intervu"), ["intervu"]);
  assert.deepEqual(parseApps("intervu,subspace"), ["intervu", "subspace"]);
  assert.deepEqual(parseApps(" Intervu , SUBSPACE "), ["intervu", "subspace"]);
  assert.deepEqual(parseApps("intervu,,subspace,"), ["intervu", "subspace"]);
  assert.deepEqual(parseApps(""), []);
  assert.deepEqual(parseApps(undefined), []);
  assert.deepEqual(parseApps(null), []);
});

test("mergeApps is additive, deduped and order-independent", () => {
  // Order-independence is the property that matters: the two migrations can run
  // in either order, and re-runs are expected, so the stored value must
  // converge on one string rather than drift.
  assert.equal(mergeApps(undefined, APP_INTERVU), "intervu");
  assert.equal(mergeApps("intervu", APP_SUBSPACE), "intervu,subspace");
  assert.equal(mergeApps("subspace", APP_INTERVU), "intervu,subspace");
  assert.equal(mergeApps("intervu", APP_INTERVU), "intervu");
  assert.equal(mergeApps("intervu,subspace", APP_SUBSPACE), "intervu,subspace");
});

test("hasApp answers the question the whole scheme exists for", () => {
  assert.equal(hasApp("intervu,subspace", APP_INTERVU), true);
  assert.equal(hasApp("subspace", APP_INTERVU), false);
  assert.equal(hasApp(undefined, APP_SUBSPACE), false);
});

/**
 * The dual-product user is the case that can destroy an account without
 * erroring. One email is one WorkOS identity, so someone with accounts in both
 * products arrives as a single user — and the second migration to reach them
 * must not undo the first.
 */
test("an existing external_id is never overwritten", () => {
  const update = buildUpdatePayload(
    { externalId: "firebase-uid-abc", metadata: { apps: "intervu" } },
    {
      email: "both@example.com",
      external_id: "supabase-uuid-xyz",
      metadata: { apps: "subspace", supabase_uid: "supabase-uuid-xyz" },
    },
  );

  // Overwriting this would orphan every Firestore document the user owns while
  // their login kept working.
  assert.equal(update.external_id, undefined);
  // The other system's id still travels — just not in the key field.
  assert.equal((update.metadata as Record<string, string>).supabase_uid, "supabase-uuid-xyz");
});

test("a user with no external_id gets one — the repair case", () => {
  // Distinct from the case above: nothing is being overwritten here, so
  // populating the field is a fix rather than a loss.
  for (const missing of [null, undefined, ""]) {
    const update = buildUpdatePayload(
      { externalId: missing, metadata: {} },
      { email: "a@b.com", external_id: "uid-1", metadata: { apps: "subspace" } },
    );
    assert.equal(update.external_id, "uid-1", `externalId=${JSON.stringify(missing)}`);
  }
});

test("apps merge across the two migrations instead of replacing", () => {
  const update = buildUpdatePayload(
    { externalId: "x", metadata: { apps: "intervu" } },
    { email: "a@b.com", external_id: "y", metadata: { apps: "subspace" } },
  );
  // A replace here would silently evict the user from intervu.
  assert.equal((update.metadata as Record<string, string>).apps, "intervu,subspace");
});

test("existing metadata survives an update", () => {
  // The migration writes a few keys; anything else on the record belongs to
  // someone else and must not be dropped by a partial write.
  const update = buildUpdatePayload(
    { externalId: "x", metadata: { apps: "intervu", firebase_uid: "fb-1", photo_url: "u" } },
    { email: "a@b.com", external_id: "y", metadata: { apps: "subspace", supabase_uid: "sb-1" } },
  );
  const metadata = update.metadata as Record<string, string>;
  assert.equal(metadata.firebase_uid, "fb-1");
  assert.equal(metadata.photo_url, "u");
  assert.equal(metadata.supabase_uid, "sb-1");
  assert.equal(metadata.apps, "intervu,subspace");
});

test("a name already on the record is not blanked by a source that lacks one", () => {
  const keeps = buildUpdatePayload(
    { externalId: "x", firstName: "Ada", lastName: "Lovelace", metadata: {} },
    { email: "a@b.com", external_id: "y", metadata: { apps: "subspace" } },
  );
  assert.equal(keeps.first_name, undefined);
  assert.equal(keeps.last_name, undefined);

  // ...but a missing name IS filled in when the incoming source has one.
  const fills = buildUpdatePayload(
    { externalId: "x", metadata: {} },
    { email: "a@b.com", external_id: "y", first_name: "Ada", metadata: { apps: "subspace" } },
  );
  assert.equal(fills.first_name, "Ada");
});

test("verification is only ever turned on, never off", () => {
  // A source that does not know the address is verified must not un-verify it —
  // WorkOS refuses password auth for an unverified address, so that would lock
  // the user out.
  const off = buildUpdatePayload(
    { externalId: "x", metadata: {} },
    { email: "a@b.com", external_id: "y", email_verified: false, metadata: { apps: "subspace" } },
  );
  assert.equal(off.email_verified, undefined);

  const on = buildUpdatePayload(
    { externalId: "x", metadata: {} },
    { email: "a@b.com", external_id: "y", email_verified: true, metadata: { apps: "subspace" } },
  );
  assert.equal(on.email_verified, true);
});

test("email is never sent back — it is the match key", () => {
  const update = buildUpdatePayload(
    { externalId: "x", metadata: {} },
    { email: "a@b.com", external_id: "y", metadata: { apps: "subspace" } },
  );
  assert.equal(update.email, undefined);
});
