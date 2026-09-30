"use client";

import { useEffect, useState } from "react";
import { getContactCookieFollowStateAction, type ContactCookieFollowState } from "@/actions/email-follow";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";

export type CompanyEmailVerifiedChannel = {
  emailVerified: boolean;
  /** This browser carries a verified email identity (the contact cookie), so
   *  a guest's Follow click can follow in one click instead of asking for an
   *  email again. */
  contactKnown: boolean;
  onGuestFollow: () => void;
  onGuestUnfollow: () => void;
};

type ContactStatus = ContactCookieFollowState["status"];

/**
 * Pure: is a signed-out visitor following this company? A click this visit
 * wins; then the server's read of the contact cookie; `?followed=1` (the
 * verify redirect) only covers the moment before that read returns, or a
 * store that can't answer. "no-contact" means this browser has no verified
 * identity, so a `?followed=1` it carries is someone else's shared link.
 */
export function resolveGuestEmailFollow(input: {
  followedParam: boolean;
  contact: ContactStatus | null;
  clicked: boolean | null;
}): boolean {
  if (input.clicked !== null) return input.clicked;
  if (input.contact === "following") return true;
  if (input.contact === "not-following" || input.contact === "no-contact") return false;
  return input.followedParam;
}

/**
 * Signed-out follow channel for a company page, shared by
 * `CompanyFollowControl` and `CompanyIntelGate` via
 * `CompanyFollowChannelProvider` so a follow in one surface unlocks the other
 * without a reload. Opening the page only READS whether this browser's
 * verified identity follows the company; the follow itself is written by a
 * click (`FollowButton`). This used to follow on every mount, so a guest's
 * Unfollow came back on the next load and every company page they opened was
 * followed (J-COMPANY-18).
 */
export function useCompanyEmailVerifiedChannel(domain: string): CompanyEmailVerifiedChannel {
  const normalizedDomain = domain.trim().toLowerCase();
  const [user, setUser] = useState(() => getCurrentUser());
  const [followedParam, setFollowedParam] = useState(false);
  // Both are kept with the domain they belong to, so a page that swaps
  // companies without remounting never shows the last company's answer.
  const [contact, setContact] = useState<{ domain: string; status: ContactStatus } | null>(null);
  const [clicked, setClicked] = useState<{ domain: string; following: boolean } | null>(null);

  useEffect(() => onAuthChange(setUser), []);

  useEffect(() => {
    // Client-only read, deliberately not in the initial useState so the
    // first client render still matches the server-rendered (window-less)
    // markup before this effect flips it.
    const params = new URLSearchParams(window.location.search);
    if (params.get("followed") !== "1") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration match; see CompanyFollowControl doc
    setFollowedParam(true);
    // One-shot marker from the verify redirect: drop it so a reload or a
    // copied link can't replay it after an Unfollow.
    params.delete("followed");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, []);

  useEffect(() => {
    if (user) return;
    let live = true;
    void (async () => {
      // A failed read answers nothing, the same as a store that's down.
      const status = await getContactCookieFollowStateAction({ companyDomain: normalizedDomain })
        .then((result) => result.status)
        .catch((): ContactStatus => "unavailable");
      if (live) setContact({ domain: normalizedDomain, status });
    })();
    return () => {
      live = false;
    };
  }, [user, normalizedDomain]);

  const contactStatus = contact?.domain === normalizedDomain ? contact.status : null;
  return {
    emailVerified: resolveGuestEmailFollow({
      followedParam,
      contact: contactStatus,
      clicked: clicked?.domain === normalizedDomain ? clicked.following : null,
    }),
    contactKnown: contactStatus === "following" || contactStatus === "not-following",
    onGuestFollow: () => setClicked({ domain: normalizedDomain, following: true }),
    onGuestUnfollow: () => setClicked({ domain: normalizedDomain, following: false }),
  };
}
