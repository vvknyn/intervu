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
    <div className={cn("flex shrink-0 flex-col items-end gap-2 self-start", className)}>
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
