/**
 * The contact cookie — set once a verify-email token is successfully
 * consumed, it authorizes ONLY follow/unfollow for that identity (never a
 * login session; see the design's Guards section). `setContactCookie` sets
 * httpOnly, secure-in-production, sameSite=lax, path=/ — the same posture a
 * login-session cookie would use — but on a 180-day expiry rather than a
 * login session's shorter one, since this cookie authorizes far less and can
 * safely outlive it.
 *
 * `consumeAndFollow` lives here too rather than in a third file: it is the
 * one function that turns a raw verify token into the cookie value the rest
 * of this module hands out, so the token-consumption step and the cookie it
 * feeds stay next to each other.
 */
import { cookies } from "next/headers";
import type { Queryable } from "../pg/pool";
import {
  consumeVerifyToken,
  addEmailFollow,
  consumeSearchAlertToken,
  upsertEmailSavedSearch,
  type SearchAlertAnalytics,
} from "./store";

export const CONTACT_COOKIE_NAME = "intervu_contact";
const CONTACT_COOKIE_MAX_AGE_DAYS = 180;

export async function setContactCookie(contactToken: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CONTACT_COOKIE_NAME, contactToken, {
    maxAge: CONTACT_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
  });
}

export async function getContactTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(CONTACT_COOKIE_NAME)?.value ?? null;
}

/**
 * Consumes a single-use verify token and, when a follow payload is given,
 * adds that company follow to the identity it belonged to. `follow` is
 * nullable because the primitive this backs (verify + set the contact
 * cookie) is not inherently company-bound — a plain email verification
 * with no company in flight still needs to succeed the same way.
 */
export async function consumeAndFollow(
  q: Queryable,
  rawToken: string,
  follow: { companyDomain: string; displayName: string } | null,
): Promise<{ redirectPath: string; contactToken: string; email: string } | null> {
  const consumed = await consumeVerifyToken(q, rawToken);
  if (!consumed) return null;

  if (follow) {
    await addEmailFollow(q, {
      identityId: consumed.identityId,
      companyDomain: follow.companyDomain,
      displayName: follow.displayName,
    });
  }

  return { redirectPath: consumed.redirectPath, contactToken: consumed.contactToken, email: consumed.email };
}

export async function consumeAndSaveSearchAlert(
  q: Queryable,
  rawToken: string,
): Promise<{
  redirectPath: string;
  contactToken: string;
  email: string;
  distinctId: string | null;
  analytics: SearchAlertAnalytics | null;
} | null> {
  const consumed = await consumeSearchAlertToken(q, rawToken);
  if (!consumed) return null;

  await upsertEmailSavedSearch(q, {
    identityId: consumed.identityId,
    searchHash: consumed.searchHash,
    name: consumed.name,
    href: consumed.href,
  });

  return {
    redirectPath: consumed.redirectPath,
    contactToken: consumed.contactToken,
    email: consumed.email,
    distinctId: consumed.distinctId,
    analytics: consumed.analytics,
  };
}
