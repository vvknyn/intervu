/**
 * AuthKit signup signal — hands an explicit new-user fact from the server
 * callback to the browser so `signup_completed` can fire after identify.
 *
 * Whether an account is new is decided once, server-side, by
 * `claimSignupEvent` (signup-event.ts): a fresh WorkOS `createdAt` plus a
 * durable once-per-uid claim. The callback sets the cookie only when that
 * claim is won, so a cookie is by construction one signup. Why not
 * posthog-node on the callback? This repo has no server-side PostHog client;
 * every event goes through client `captureEvent`, and sessionStorage
 * persistence means the anonymous guest distinct_id survives a same-tab
 * AuthKit redirect — identify then capture is the honest join.
 *
 * Deliberately no `next/server` import — PostHogProvider and login-form are
 * client components. The callback sets the cookie with `cookies().set()`
 * (same API WorkOS `saveSession` already uses on this route) so we never
 * wrap handleAuth's Response and risk dropping the session cookie.
 */
import type { SignupMethod } from "@/lib/analytics/event-names";

export const SIGNUP_SIGNAL_COOKIE_NAME = "intervu_signup_completed";
export const SIGNUP_SIGNAL_COOKIE_MAX_AGE = 300;

export function signupSignalCookieOptions(): {
  path: string;
  maxAge: number;
  sameSite: "lax";
  secure: boolean;
  httpOnly: false;
} {
  return {
    path: "/",
    maxAge: SIGNUP_SIGNAL_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  };
}

const SIGNUP_METHODS: readonly SignupMethod[] = ["email", "google", "username", "passkey"];

export function isSignupMethod(value: string): value is SignupMethod {
  return (SIGNUP_METHODS as readonly string[]).includes(value);
}

/** WorkOS `authenticationMethod` → analytics `method`. Unknown → null (skip). */
export function mapAuthKitSignupMethod(authenticationMethod?: string | null): SignupMethod | null {
  switch (authenticationMethod) {
    case "GoogleOAuth":
      return "google";
    case "MagicAuth":
    case "EmailVerification":
      return "email";
    case "Passkey":
      return "passkey";
    case "Password":
      return "username";
    default:
      return null;
  }
}

/** Full `Set-Cookie` header value — NOT httpOnly so the client can read it. */
export function serializeSignupSignalCookie(method: SignupMethod): string {
  const opts = signupSignalCookieOptions();
  const parts = [
    `${SIGNUP_SIGNAL_COOKIE_NAME}=${method}`,
    `Path=${opts.path}`,
    `Max-Age=${opts.maxAge}`,
    "SameSite=Lax",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Clears the signal cookie in the browser or via Set-Cookie. */
export function serializeExpiredSignupSignalCookie(): string {
  const parts = [`${SIGNUP_SIGNAL_COOKIE_NAME}=`, "Path=/", "Max-Age=0", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/** Parse `document.cookie` or a raw `Cookie` request header. */
export function parseSignupSignalCookie(cookieHeader: string): SignupMethod | null {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq);
    const value = decodeURIComponent(trimmed.slice(eq + 1));
    if (name === SIGNUP_SIGNAL_COOKIE_NAME && isSignupMethod(value)) return value;
  }
  return null;
}

/** Read-once consume in the browser after identify. */
export function consumeSignupSignalFromDocumentCookie(): SignupMethod | null {
  if (typeof document === "undefined") return null;
  const method = parseSignupSignalCookie(document.cookie);
  if (!method) return null;
  document.cookie = serializeExpiredSignupSignalCookie();
  return method;
}

/** Drop a leftover AuthKit cookie so password signup cannot double-fire. */
export function clearSignupSignalCookieFromDocument(): void {
  if (typeof document === "undefined") return;
  document.cookie = serializeExpiredSignupSignalCookie();
}
