"use client";

import { useEffect, useRef, useState } from "react";
import { AuthPopover } from "@/components/auth/auth-popover";
import { FollowButton, type FollowButtonProps } from "@/components/companies/FollowButton";
import { useCompanyFollowChannel } from "@/components/companies/CompanyFollowChannelProvider";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import { followEmailVerifiedLine, followPersistValueLine } from "@/lib/follows/persist-copy";
import { useCompanyEmailVerifiedChannel } from "@/lib/follows/use-company-email-verified";
import { syncGuestFollowsToServer } from "@/lib/follows/use-follows";
import { cn } from "@/lib/utils";

export type CompanyFollowControlProps = FollowButtonProps;

export function CompanyFollowControl(props: CompanyFollowControlProps) {
  const shared = useCompanyFollowChannel();
  if (shared) {
    return <CompanyFollowControlInner {...props} emailVerified={shared.emailVerified} onGuestUnfollow={shared.onGuestUnfollow} />;
  }
  return <CompanyFollowControlWithChannel {...props} />;
}

function CompanyFollowControlWithChannel(props: CompanyFollowControlProps) {
  const { emailVerified, onGuestUnfollow } = useCompanyEmailVerifiedChannel(props.domain, props.displayName);
  return <CompanyFollowControlInner {...props} emailVerified={emailVerified} onGuestUnfollow={onGuestUnfollow} />;
}

function CompanyFollowControlInner({
  domain,
  slug,
  displayName,
  className,
  variant,
  idleLabel,
  emailVerified,
  onGuestUnfollow,
}: CompanyFollowControlProps & {
  emailVerified: boolean;
  onGuestUnfollow: () => void;
}) {
  const [user, setUser] = useState(() => getCurrentUser());
  const [authOpen, setAuthOpen] = useState(false);
  const guestSyncRef = useRef(false);
  const guestSyncInFlightRef = useRef(false);

  useEffect(() => onAuthChange(setUser), []);

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
    // No `self-*` and no alignment of its own. `self-start` used to be baked in
    // here, and its MEANING FLIPS with the parent's flex direction: in the
    // company header (a row) it reads "top", in the unlock overlay (a column)
    // it reads "left" — so the overlay's `items-center` was silently overruled
    // and the Follow button sat against the left edge under a centred heading
    // (Vivek, 2026-08-24: "center the button"). A control cannot know the axis
    // of a container it doesn't own, so placement — and the text alignment that
    // follows from it — is the caller's to state. Both call sites that wanted
    // the old behaviour now say so; one of them was already passing
    // `sm:self-start` to re-state what it was getting anyway.
    <div className={cn("flex shrink-0 flex-col gap-2", className)}>
      <FollowButton
        domain={domain}
        slug={slug}
        displayName={displayName}
        variant={variant}
        emailVerified={emailVerified}
        idleLabel={idleLabel}
        onGuestUnfollow={onGuestUnfollow}
        onSignInInstead={() => setAuthOpen(true)}
      />
      {!user && emailVerified && (
        <p
          data-testid="follow-email-verified"
          // Inherits its alignment from the caller alongside the button, so the
          // caption can't end up right-aligned under a centred control.
          className="max-w-[220px] text-xs leading-snug text-muted-foreground"
        >
          {followEmailVerifiedLine(displayName)}
        </p>
      )}
      <AuthPopover
        open={authOpen}
        onOpenChange={setAuthOpen}
        showTrigger={false}
        trigger="user"
        onAuthed={() => void syncGuestFollowsToServer()}
        valueLine={followPersistValueLine(displayName)}
      />
    </div>
  );
}
