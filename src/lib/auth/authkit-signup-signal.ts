/**
 * AuthKit signup signal — hands an explicit new-user fact from the server
 * callback to the browser so `signup_completed` can fire after identify.
 *
 * Why not `user.createdAt ≈ now`? That is inference, not a fact — a returning
 * user whose record was just created in WorkOS for another reason, or clock
 * skew, would false-positive. Why not posthog-node on the callback? This repo
 * has no server-side PostHog client; every event goes through client
 * `captureEvent`, and sessionStorage persistence means the anonymous guest
 * distinct_id survives a same-tab AuthKit redirect — identify then capture is
 * the honest join.
 *
 * The signal is `!hasApp(metadata.apps, intervu)` evaluated BEFORE
 * `provisionAppAccess` tags the user — the same cheap check provisioning
 * already uses. Returning intervu users carry the tag → no cookie. Brand-new
 * Google/passkey/magic-auth users do not → short-lived cookie the client reads
 * once after `posthog.identify(uid)`.
 */
import { NextResponse } from "next/server";
import type { SignupMethod } from "@/lib/analytics/event-names";
import { APP_INTERVU, hasApp } from "@/lib/auth/workos-apps";

export const SIGNUP_SIGNAL_COOKIE_NAME = "intervu_signup_completed";
const SIGNUP_SIGNAL_COOKIE_MAX_AGE = 300;

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

/** Decide whether this AuthKit success is a first-time intervu signup. */
export function resolveAuthKitSignupSignal({
  apps,
  authenticationMethod,
}: {
  apps?: string | null;
  authenticationMethod?: string | null;
}): SignupMethod | null {
  if (hasApp(apps, APP_INTERVU)) return null;
  return mapAuthKitSignupMethod(authenticationMethod);
}

/** Full `Set-Cookie` header value — NOT httpOnly so the client can read it. */
export function serializeSignupSignalCookie(method: SignupMethod): string {
  const parts = [
    `${SIGNUP_SIGNAL_COOKIE_NAME}=${method}`,
    "Path=/",
    `Max-Age=${SIGNUP_SIGNAL_COOKIE_MAX_AGE}`,
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
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

/** Append the signal onto handleAuth's Response — cookies().set() cannot merge into a third-party Response. */
export function attachSignupSignalCookie(response: Response, method: SignupMethod | null): Response {
  if (!method) return response;
  const next = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  next.headers.append("Set-Cookie", serializeSignupSignalCookie(method));
  return next;
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
