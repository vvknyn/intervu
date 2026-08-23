import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_INTERVU, appsFromClaims, hasApp, resolveLegacyUid } from "../../src/lib/auth/app-tag";

test("appsFromClaims returns both slugs from an apps array", () => {
  assert.deepEqual(appsFromClaims({ apps: ["subspace", "intervu"] }), ["subspace", "intervu"]);
});

test("appsFromClaims returns a single slug from a one-element apps array", () => {
  assert.deepEqual(appsFromClaims({ apps: [APP_INTERVU] }), [APP_INTERVU]);
});

test("appsFromClaims returns [] for an empty apps array", () => {
  assert.deepEqual(appsFromClaims({ apps: [] }), []);
});

test("appsFromClaims fails closed when app_metadata is absent, null, or undefined", () => {
  assert.deepEqual(appsFromClaims(undefined), []);
  assert.deepEqual(appsFromClaims(null), []);
  // "absent" as in a caller passing the property through when it was never set
  const noField: { app_metadata?: unknown } = {};
  assert.deepEqual(appsFromClaims(noField.app_metadata), []);
});

test("appsFromClaims fails closed when app_metadata is a wrong-typed scalar or array", () => {
  assert.deepEqual(appsFromClaims("intervu"), []);
  assert.deepEqual(appsFromClaims(42), []);
  assert.deepEqual(appsFromClaims(["intervu"]), []);
  assert.deepEqual(appsFromClaims(true), []);
});

test("appsFromClaims tolerates a legacy scalar string at .apps as a one-element array", () => {
  assert.deepEqual(appsFromClaims({ apps: "intervu" }), ["intervu"]);
});

test("appsFromClaims fails closed when .apps is a non-array, non-string scalar", () => {
  assert.deepEqual(appsFromClaims({ apps: 7 }), []);
  assert.deepEqual(appsFromClaims({ apps: null }), []);
  assert.deepEqual(appsFromClaims({ apps: { subspace: true } }), []);
});

test("appsFromClaims drops non-string entries from an apps array rather than throwing", () => {
  assert.deepEqual(appsFromClaims({ apps: ["intervu", 5, null, "subspace"] }), ["intervu", "subspace"]);
});

test("hasApp is true only when the tag is present", () => {
  assert.equal(hasApp({ apps: ["subspace", "intervu"] }, "intervu"), true);
  assert.equal(hasApp({ apps: ["subspace"] }, "intervu"), false);
  assert.equal(hasApp({ apps: [] }, "intervu"), false);
  assert.equal(hasApp(null, "intervu"), false);
});

test("hasApp is generic, not special-cased to intervu — proven on an unrelated slug", () => {
  assert.equal(hasApp({ apps: ["subspace"] }, "subspace"), true);
  assert.equal(hasApp({ apps: ["intervu"] }, "subspace"), false);
  assert.equal(hasApp({ apps: "subspace" }, "subspace"), true);
  assert.equal(hasApp({ apps: ["subspace", "intervu"] }, "some-future-product"), false);
});

test("resolveLegacyUid returns firebase_uid when it is a non-empty string", () => {
  assert.equal(
    resolveLegacyUid({ id: "sb-uuid-1", app_metadata: { firebase_uid: "fb-uid-legacy" } }),
    "fb-uid-legacy",
  );
});

test("resolveLegacyUid falls back to user.id when app_metadata is absent", () => {
  assert.equal(resolveLegacyUid({ id: "sb-uuid-2" }), "sb-uuid-2");
});

test("resolveLegacyUid falls back to user.id when firebase_uid is an empty string", () => {
  assert.equal(
    resolveLegacyUid({ id: "sb-uuid-3", app_metadata: { firebase_uid: "" } }),
    "sb-uuid-3",
  );
});

test("resolveLegacyUid falls back to user.id when firebase_uid is whitespace-only", () => {
  assert.equal(
    resolveLegacyUid({ id: "sb-uuid-4", app_metadata: { firebase_uid: "   " } }),
    "sb-uuid-4",
  );
});

test("resolveLegacyUid falls back to user.id when firebase_uid is present but not a string", () => {
  assert.equal(
    resolveLegacyUid({ id: "sb-uuid-5", app_metadata: { firebase_uid: 12345 } }),
    "sb-uuid-5",
  );
  assert.equal(
    resolveLegacyUid({ id: "sb-uuid-6", app_metadata: { firebase_uid: null } }),
    "sb-uuid-6",
  );
});

test("resolveLegacyUid falls back to user.id when app_metadata is malformed", () => {
  assert.equal(resolveLegacyUid({ id: "sb-uuid-7", app_metadata: "not-an-object" }), "sb-uuid-7");
  assert.equal(resolveLegacyUid({ id: "sb-uuid-8", app_metadata: null }), "sb-uuid-8");
});
