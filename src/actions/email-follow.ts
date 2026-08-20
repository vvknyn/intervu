"use server";

/**
 * One-click follow/unfollow via the contact cookie (Task 6's identity
 * primitive) — no email step, no auth session. `followByContactCookie` /
 * `unfollowByContactCookie` are deps-injected (same pattern as
 * `submitFollowEmail` in lib/identity/submit-follow.ts) so the decision
 * ladder — PG availability, cookie presence, identity lookup — is
 * unit-testable without a Next request context. The `*Action` exports wrap
 * them with the real cookie/pool deps for client components to call.
 */
import { getIntervuPg, type Queryable } from "@/lib/pg/pool";
import { getContactTokenFromCookies } from "@/lib/identity/contact-cookie";
import { getIdentityByContactToken, addEmailFollow, removeEmailFollow } from "@/lib/identity/store";

export interface ContactCookieFollowDeps {
  q: Queryable | null;
  getContactToken(): Promise<string | null>;
}

export type FollowByContactCookieResult = { status: "followed" | "no-contact" | "unavailable" };
export type UnfollowByContactCookieResult = { status: "unfollowed" | "no-contact" | "unavailable" };

export async function followByContactCookie(
  deps: ContactCookieFollowDeps,
  input: { companyDomain: string; displayName: string },
): Promise<FollowByContactCookieResult> {
  if (deps.q === null) return { status: "unavailable" };

  const token = await deps.getContactToken();
  if (!token) return { status: "no-contact" };

  // A cookie may outlive the identity it named (deletion, stale browser
  // state) — an unknown token is never an error, just "you're not known".
  const identity = await getIdentityByContactToken(deps.q, token);
  if (!identity) return { status: "no-contact" };

  await addEmailFollow(deps.q, {
    identityId: identity.id,
    companyDomain: input.companyDomain,
    displayName: input.displayName,
  });
  return { status: "followed" };
}

export async function unfollowByContactCookie(
  deps: ContactCookieFollowDeps,
  input: { companyDomain: string },
): Promise<UnfollowByContactCookieResult> {
  if (deps.q === null) return { status: "unavailable" };

  const token = await deps.getContactToken();
  if (!token) return { status: "no-contact" };

  const identity = await getIdentityByContactToken(deps.q, token);
  if (!identity) return { status: "no-contact" };

  await removeEmailFollow(deps.q, identity.id, input.companyDomain);
  return { status: "unfollowed" };
}

export async function followByContactCookieAction(input: {
  companyDomain: string;
  displayName: string;
}): Promise<FollowByContactCookieResult> {
  return followByContactCookie({ q: getIntervuPg(), getContactToken: getContactTokenFromCookies }, input);
}

export async function unfollowByContactCookieAction(input: {
  companyDomain: string;
}): Promise<UnfollowByContactCookieResult> {
  return unfollowByContactCookie({ q: getIntervuPg(), getContactToken: getContactTokenFromCookies }, input);
}
