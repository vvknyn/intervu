"use client";

import { useEffect, useRef, useState } from "react";
import { followByContactCookieAction } from "@/actions/email-follow";
import { AuthPopover } from "@/components/auth/auth-popover";
import { FollowButton, type FollowButtonProps } from "@/components/companies/FollowButton";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import { followEmailVerifiedLine, followPersistValueLine } from "@/lib/follows/persist-copy";
import { syncGuestFollowsToServer } from "@/lib/follows/use-follows";
import { cn } from "@/lib/utils";

export type CompanyFollowControlProps = FollowButtonProps;

export function CompanyFollowControl({
  domain,
  slug,
  displayName,
  className,
  variant,
}: CompanyFollowControlProps) {
  const normalizedDomain = domain.trim().toLowerCase();
  const [user, setUser] = useState(() => getCurrentUser());
  const [authOpen, setAuthOpen] = useState(false);
  // Set from the ?followed=1 redirect (verify route) or a one-click
  // contact-cookie follow below — either way the visitor already has a
  // real, verified email channel for this company.
  const [followedParam, setFollowedParam] = useState(false);
  const [contactVerified, setContactVerified] = useState(false);
  // A verified channel can still be revoked mid-session (FollowButton's own
  // unfollow-by-contact-cookie) — neither of the two flags above is
  // otherwise reversible client-side, so this is the third state, not a
  // second meaning bolted onto either of them.
  const [manuallyUnfollowed, setManuallyUnfollowed] = useState(false);
  const guestSyncRef = useRef(false);
  const guestSyncInFlightRef = useRef(false);
  const contactCheckRef = useRef(false);

  const emailVerified = (followedParam || contactVerified) && !manuallyUnfollowed;

  useEffect(() => onAuthChange(setUser), []);

  useEffect(() => {
    // Client-only read, deliberately not in the initial useState so the
    // first client render still matches the server-rendered (window-less)
    // markup before this effect flips it.
    setFollowedParam(new URLSearchParams(window.location.search).get("followed") === "1");
  }, []);

  // Returning verified visitor, new company: try the one-click follow via
  // the contact cookie on mount, before ever showing the email step. One
  // request per page view — this component renders once per company page,
  // so (unlike the hot-table pill) a click-time check isn't needed to avoid
  // an N-request fan-out.
  useEffect(() => {
    if (user || followedParam || contactCheckRef.current) return;
    contactCheckRef.current = true;
    void (async () => {
      const result = await followByContactCookieAction({ companyDomain: normalizedDomain, displayName });
      if (result.status === "followed") setContactVerified(true);
    })();
  }, [user, followedParam, normalizedDomain, displayName]);

  useEffect(() => {
    if (user && !guestSyncRef.current && !guestSyncInFlightRef.current) {
      guestSyncInFlightRef.current = true;
      void (async () => {
        try {
          const ok = await syncGuestFollowsToServer();
          if (ok) guestSyncRef.current = true;
        } finally {
          guestSyncInFlightRef.current = false;
        }
      })();
    }
  }, [user]);

  return (
    <div className={cn("flex shrink-0 flex-col items-end gap-2 self-start", className)}>
      <FollowButton
        domain={domain}
        slug={slug}
        displayName={displayName}
        variant={variant}
        emailVerified={emailVerified}
        onGuestUnfollow={() => setManuallyUnfollowed(true)}
        onSignInInstead={() => setAuthOpen(true)}
      />
      {!user && emailVerified && (
        <p
          data-testid="follow-email-verified"
          className="max-w-[220px] text-right text-xs leading-snug text-muted-foreground"
        >
          {followEmailVerifiedLine(displayName)}
        </p>
      )}
      <AuthPopover
        open={authOpen}
        onOpenChange={setAuthOpen}
        showTrigger={false}
        onAuthed={() => void syncGuestFollowsToServer()}
        valueLine={followPersistValueLine(displayName)}
      />
    </div>
  );
}
