"use client";

import { useEffect, useRef, useState } from "react";
import { AuthPopover } from "@/components/auth/auth-popover";
import { FollowButton, type FollowButtonProps } from "@/components/companies/FollowButton";
import { Button } from "@/components/ui/button";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import {
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
  const guestSyncRef = useRef(false);
  const guestSyncInFlightRef = useRef(false);

  const following = byDomain.has(normalizedDomain);
  const showPersistPrompt = !user && following;

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
      <FollowButton domain={domain} slug={slug} displayName={displayName} variant={variant} />
      {showPersistPrompt && (
        <div data-testid="follow-persist-prompt" className="max-w-[220px] text-right">
          <p className="text-xs leading-snug text-muted-foreground">{followPersistLine(displayName)}</p>
          <Button
            type="button"
            variant="link"
            size="sm"
            data-testid="follow-persist-cta"
            className="h-auto px-0 py-0 text-xs font-medium text-brand"
            onClick={() => setAuthOpen(true)}
          >
            {followPersistCta()}
          </Button>
        </div>
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
