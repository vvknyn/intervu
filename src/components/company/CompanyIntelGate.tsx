"use client";

import { type ReactNode } from "react";
import { CompanyFollowControl } from "@/components/companies/CompanyFollowControl";
import { useCompanyFollowChannel } from "@/components/companies/CompanyFollowChannelProvider";
import { resolveFollowingState } from "@/components/companies/FollowButton";
import { useCompanyEmailVerifiedChannel } from "@/lib/follows/use-company-email-verified";
import { useFollows } from "@/lib/follows/use-follows";
import { cn } from "@/lib/utils";

export type CompanyIntelGateProps = {
  domain: string;
  slug: string;
  displayName: string;
  children: ReactNode;
};

/** Pure unlock decision — mirrors `FollowButton`'s confirmed-following formula. */
export function isCompanyIntelUnlocked(input: {
  accountFollowing: boolean;
  isSignedIn: boolean;
  emailVerified: boolean;
}): boolean {
  return resolveFollowingState(input);
}

export function CompanyIntelGate(props: CompanyIntelGateProps) {
  const shared = useCompanyFollowChannel();
  if (shared) {
    return <CompanyIntelGateInner {...props} emailVerified={shared.emailVerified} />;
  }
  return <CompanyIntelGateWithChannel {...props} />;
}

function CompanyIntelGateWithChannel(props: CompanyIntelGateProps) {
  const { emailVerified } = useCompanyEmailVerifiedChannel(props.domain, props.displayName);
  return <CompanyIntelGateInner {...props} emailVerified={emailVerified} />;
}

function CompanyIntelGateInner({
  domain,
  slug,
  displayName,
  children,
  emailVerified,
}: CompanyIntelGateProps & { emailVerified: boolean }) {
  const normalizedDomain = domain.trim().toLowerCase();
  const { byDomain, isSignedIn } = useFollows();

  const unlocked = isCompanyIntelUnlocked({
    accountFollowing: byDomain.has(normalizedDomain),
    isSignedIn,
    emailVerified,
  });

  return (
    <div
      data-testid="company-intel-gate"
      data-unlocked={unlocked ? "true" : "false"}
      className="relative"
    >
      <div
        className={cn(!unlocked && "pointer-events-none select-none blur-[6px]")}
        aria-hidden={!unlocked}
      >
        {children}
      </div>
      {!unlocked && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-card/55 px-6 py-10 text-center">
          <p className="text-[15px] font-semibold text-foreground">Follow to unlock hiring intel</p>
          <CompanyFollowControl
            domain={domain}
            slug={slug}
            displayName={displayName}
            variant="primary"
            idleLabel="Follow to unlock hiring intel"
          />
        </div>
      )}
    </div>
  );
}
