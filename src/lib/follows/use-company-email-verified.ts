"use client";

import { useEffect, useRef, useState } from "react";
import { followByContactCookieAction } from "@/actions/email-follow";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";

export type CompanyEmailVerifiedChannel = {
  emailVerified: boolean;
  onGuestUnfollow: () => void;
};

/**
 * Signed-out follow channel detection for a company page — `?followed=1`
 * (verify redirect) or a one-click contact-cookie follow on mount. Shared
 * by `CompanyFollowControl` and `CompanyIntelGate` via
 * `CompanyFollowChannelProvider` so a follow unlocked in one surface
 * unlocks the other without a reload.
 */
export function useCompanyEmailVerifiedChannel(domain: string, displayName: string): CompanyEmailVerifiedChannel {
  const normalizedDomain = domain.trim().toLowerCase();
  const [user, setUser] = useState(() => getCurrentUser());
  const [followedParam, setFollowedParam] = useState(false);
  const [contactVerified, setContactVerified] = useState(false);
  const [manuallyUnfollowed, setManuallyUnfollowed] = useState(false);
  const contactCheckRef = useRef(false);

  const emailVerified = (followedParam || contactVerified) && !manuallyUnfollowed;

  useEffect(() => onAuthChange(setUser), []);

  useEffect(() => {
    // Client-only read, deliberately not in the initial useState so the
    // first client render still matches the server-rendered (window-less)
    // markup before this effect flips it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration match; see CompanyFollowControl doc
    setFollowedParam(new URLSearchParams(window.location.search).get("followed") === "1");
  }, []);

  useEffect(() => {
    if (user || followedParam || contactCheckRef.current) return;
    contactCheckRef.current = true;
    void (async () => {
      const result = await followByContactCookieAction({ companyDomain: normalizedDomain, displayName });
      if (result.status === "followed") setContactVerified(true);
    })();
  }, [user, followedParam, normalizedDomain, displayName]);

  return {
    emailVerified,
    onGuestUnfollow: () => setManuallyUnfollowed(true),
  };
}
