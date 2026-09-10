import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapAuthKitSignupMethod,
  resolveAuthKitSignupSignal,
  serializeSignupSignalCookie,
  serializeExpiredSignupSignalCookie,
  parseSignupSignalCookie,
  signupSignalCookieOptions,
  isSignupMethod,
  SIGNUP_SIGNAL_COOKIE_NAME,
} from "../../src/lib/auth/authkit-signup-signal";

test("mapAuthKitSignupMethod maps known WorkOS methods", () => {
  assert.equal(mapAuthKitSignupMethod("GoogleOAuth"), "google");
  assert.equal(mapAuthKitSignupMethod("MagicAuth"), "email");
  assert.equal(mapAuthKitSignupMethod("EmailVerification"), "email");
  assert.equal(mapAuthKitSignupMethod("Passkey"), "passkey");
  assert.equal(mapAuthKitSignupMethod("Password"), "username");
});

test("mapAuthKitSignupMethod returns null for unknown or missing methods", () => {
  assert.equal(mapAuthKitSignupMethod("ExternalAuth"), null);
  assert.equal(mapAuthKitSignupMethod("SSO"), null);
  assert.equal(mapAuthKitSignupMethod(null), null);
  assert.equal(mapAuthKitSignupMethod(undefined), null);
});

test("resolveAuthKitSignupSignal: tagged intervu user → null even for GoogleOAuth", () => {
  assert.equal(
    resolveAuthKitSignupSignal({ apps: "intervu", authenticationMethod: "GoogleOAuth" }),
    null,
  );
  assert.equal(
    resolveAuthKitSignupSignal({ apps: "intervu,subspace", authenticationMethod: "Passkey" }),
    null,
  );
});

test("resolveAuthKitSignupSignal: untagged Google → google", () => {
  assert.equal(
    resolveAuthKitSignupSignal({ apps: undefined, authenticationMethod: "GoogleOAuth" }),
    "google",
  );
});

test("resolveAuthKitSignupSignal: subspace-only apps without intervu → still a signal", () => {
  assert.equal(
    resolveAuthKitSignupSignal({ apps: "subspace", authenticationMethod: "GoogleOAuth" }),
    "google",
  );
});

test("resolveAuthKitSignupSignal: untagged unknown method → null", () => {
  assert.equal(
    resolveAuthKitSignupSignal({ apps: null, authenticationMethod: "ExternalAuth" }),
    null,
  );
});

test("isSignupMethod accepts only known methods", () => {
  assert.equal(isSignupMethod("google"), true);
  assert.equal(isSignupMethod("email"), true);
  assert.equal(isSignupMethod("passkey"), true);
  assert.equal(isSignupMethod("username"), true);
  assert.equal(isSignupMethod("oauth"), false);
  assert.equal(isSignupMethod(""), false);
});

test("serializeSignupSignalCookie round-trips through parseSignupSignalCookie", () => {
  const serialized = serializeSignupSignalCookie("google");
  assert.match(serialized, new RegExp(`^${SIGNUP_SIGNAL_COOKIE_NAME}=google`));
  assert.match(serialized, /Path=\//);
  assert.match(serialized, /Max-Age=300/);
  assert.match(serialized, /SameSite=Lax/);
  assert.doesNotMatch(serialized, /HttpOnly/i);

  assert.equal(parseSignupSignalCookie(serialized), "google");
});

test("parseSignupSignalCookie rejects garbage values", () => {
  assert.equal(parseSignupSignalCookie(`${SIGNUP_SIGNAL_COOKIE_NAME}=oauth`), null);
  assert.equal(parseSignupSignalCookie("other=value"), null);
  assert.equal(parseSignupSignalCookie(""), null);
});

test("parseSignupSignalCookie reads from a multi-cookie header", () => {
  const header = `session=abc; ${SIGNUP_SIGNAL_COOKIE_NAME}=passkey; theme=dark`;
  assert.equal(parseSignupSignalCookie(header), "passkey");
});

test("serializeExpiredSignupSignalCookie clears with Max-Age=0", () => {
  const serialized = serializeExpiredSignupSignalCookie();
  assert.match(serialized, new RegExp(`^${SIGNUP_SIGNAL_COOKIE_NAME}=`));
  assert.match(serialized, /Max-Age=0/);
});

test("signupSignalCookieOptions is client-readable (not httpOnly)", () => {
  const opts = signupSignalCookieOptions();
  assert.equal(opts.httpOnly, false);
  assert.equal(opts.path, "/");
  assert.equal(opts.maxAge, 300);
  assert.equal(opts.sameSite, "lax");
});
