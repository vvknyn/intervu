"use client";

import { useEffect, useRef, useState } from "react";
import { followByContactCookieAction } from "@/actions/email-follow";
import { AuthPopover } from "@/components/auth/auth-popover";
import { FollowButton, type FollowButtonProps } from "@/components/companies/FollowButton";
import { FollowEmailStep } from "@/components/companies/FollowEmailStep";
import { Button } from "@/components/ui/button";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import {
  followEmailVerifiedLine,
  followPersistCta,
  followPersistLine,
  followPersistValueLine,
} from "@/lib/follows/persist-copy";
import { syncGuestFollowsToServer, useFollows } from "@/lib/follows/use-follows";
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
  const { byDomain } = useFollows();
  const [user, setUser] = useState(() => getCurrentUser());
  const [authOpen, setAuthOpen] = useState(false);
  const [emailStepOpen, setEmailStepOpen] = useState(false);
  // Set from the ?followed=1 redirect (verify route) or a one-click
  // contact-cookie follow below — either way the visitor is already a
  // verified email follower and never needs the email step again.
  const [followedParam, setFollowedParam] = useState(false);
  const [contactVerified, setContactVerified] = useState(false);
  const guestSyncRef = useRef(false);
  const guestSyncInFlightRef = useRef(false);
  const contactCheckRef = useRef(false);

  const following = byDomain.has(normalizedDomain);
  const showPersistPrompt = !user && following;
  const emailVerified = followedParam || contactVerified;

  useEffect(() => onAuthChange(setUser), []);

  useEffect(() => {
    // Client-only read, deliberately not in the initial useState so the
    // first client render still matches the server-rendered (window-less)
    // markup before this effect flips it.
    setFollowedParam(new URLSearchParams(window.location.search).get("followed") === "1");
  }, []);

  // Returning verified visitor, new company: try the one-click follow via
  // the contact cookie before ever showing the email step again.
  useEffect(() => {
    if (!showPersistPrompt || followedParam || contactCheckRef.current) return;
    contactCheckRef.current = true;
    void (async () => {
      const result = await followByContactCookieAction({ companyDomain: normalizedDomain, displayName });
      if (result.status === "followed") setContactVerified(true);
    })();
  }, [showPersistPrompt, followedParam, normalizedDomain, displayName]);

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
      <FollowButton domain={domain} slug={slug} displayName={displayName} variant={variant} />
      {showPersistPrompt && emailVerified && (
        <p
          data-testid="follow-email-verified"
          className="max-w-[220px] text-right text-xs leading-snug text-muted-foreground"
        >
          {followEmailVerifiedLine(displayName)}
        </p>
      )}
      {showPersistPrompt && !emailVerified && !emailStepOpen && (
        <div data-testid="follow-persist-prompt" className="max-w-[220px] text-right">
          <p className="text-xs leading-snug text-muted-foreground">{followPersistLine(displayName)}</p>
          <Button
            type="button"
            variant="link"
            size="sm"
            data-testid="follow-persist-cta"
            className="h-auto px-0 py-0 text-xs font-medium text-brand"
            onClick={() => setEmailStepOpen(true)}
          >
            {followPersistCta()}
          </Button>
        </div>
      )}
      {showPersistPrompt && !emailVerified && emailStepOpen && (
        <FollowEmailStep
          companyDomain={normalizedDomain}
          displayName={displayName}
          onSignInInstead={() => {
            setEmailStepOpen(false);
            setAuthOpen(true);
          }}
        />
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
