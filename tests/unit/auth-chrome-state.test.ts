import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthChrome } from "../../src/lib/auth/chrome-state";

test("undefined is pending, not anonymous — the whole point", () => {
  // If this ever returns "anonymous", signed-in users get a Sign-in button
  // flashed at them during the server round-trip.
  assert.equal(resolveAuthChrome(undefined), "pending");
});

test("null is anonymous — a resolved answer of nobody", () => {
  assert.equal(resolveAuthChrome(null), "anonymous");
});

test("any user object is authenticated, whatever its shape", () => {
  // Deliberately not tied to one provider's user shape: Firebase and WorkOS
  // return different objects and the chrome must not care which it got.
  assert.equal(resolveAuthChrome({ email: "a@b.c" }), "authenticated");
  assert.equal(resolveAuthChrome({ id: "user_123", firstName: "Ada" }), "authenticated");
  assert.equal(resolveAuthChrome({}), "authenticated");
});

test("the three states are exhaustive and mutually exclusive", () => {
  const seen = new Set(
    [undefined, null, { email: "x@y.z" }].map((u) => resolveAuthChrome(u)),
  );
  assert.deepEqual([...seen].sort(), ["anonymous", "authenticated", "pending"]);
});
