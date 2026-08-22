/**
 * The contact cookie — set once a verify-email token is successfully
 * consumed, it authorizes ONLY follow/unfollow for that identity (never a
 * login session; see the design's Guards section). `setContactCookie`
 * mirrors `firebase/auth-session.ts`'s `setSessionCookie` httpOnly/secure/
 * sameSite/path posture exactly, on a 180-day expiry instead of a 14-day
 * one — this cookie authorizes far less, so it can safely outlive a login
 * session.
 *
 * `consumeAndFollow` lives here too rather than in a third file: it is the
 * one function that turns a raw verify token into the cookie value the rest
 * of this module hands out, so the token-consumption step and the cookie it
 * feeds stay next to each other.
 */
import { cookies } from "next/headers";
import type { Queryable } from "../pg/pool";
import { consumeVerifyToken, addEmailFollow } from "./store";

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
): Promise<{ redirectPath: string; contactToken: string } | null> {
  const consumed = await consumeVerifyToken(q, rawToken);
  if (!consumed) return null;

  if (follow) {
    await addEmailFollow(q, {
      identityId: consumed.identityId,
      companyDomain: follow.companyDomain,
      displayName: follow.displayName,
    });
  }

  return { redirectPath: consumed.redirectPath, contactToken: consumed.contactToken };
}
