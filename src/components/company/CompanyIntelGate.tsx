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
  /** Names what's behind this gate's lock card. Only rendered when the card
   *  itself renders (see `fallback`). Defaults to the general "hiring
   *  changes, funding, tech stack, and news" copy. */
  description?: string;
  /** Only rendered when the lock card itself renders (see `fallback`) —
   *  omits the card's own Follow button for an instance whose card sits
   *  under another gate's button on the same page. Defaults to `true`. */
  showFollowButton?: boolean;
  /** Distinguishes two gate instances on one page (e.g. tests, analytics).
   *  Defaults to the original single-instance value. */
  testId?: string;
  /** What a locked instance shows in place of its blurred children. Omit
   *  for the built-in lock card; pass `null` when a second gate on the same
   *  page would otherwise show a duplicate card — the whole instance then
   *  renders nothing while locked (unlocked, its content still renders
   *  normally regardless of this prop). */
  fallback?: ReactNode | null;
};

/** Pure unlock decision — mirrors `FollowButton`'s confirmed-following formula. */
export function isCompanyIntelUnlocked(input: {
  accountFollowing: boolean;
  isSignedIn: boolean;
  emailVerified: boolean;
}): boolean {
  return resolveFollowingState(input);
}

/** Pure render-mode decision: a locked instance whose `fallback` is
 *  explicitly `null` renders nothing at all — never true while unlocked,
 *  regardless of `fallback` — so a page with several gate instances can
 *  suppress every card but the one it wants a visitor to see. */
export function shouldGateRenderNothing(unlocked: boolean, fallback: ReactNode | null | undefined): boolean {
  return !unlocked && fallback === null;
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
  description,
  showFollowButton = true,
  testId = "company-intel-gate",
  fallback,
}: CompanyIntelGateProps & { emailVerified: boolean }) {
  const normalizedDomain = domain.trim().toLowerCase();
  const { byDomain, isSignedIn } = useFollows();

  const unlocked = isCompanyIntelUnlocked({
    accountFollowing: byDomain.has(normalizedDomain),
    isSignedIn,
    emailVerified,
  });

  if (shouldGateRenderNothing(unlocked, fallback)) {
    return null;
  }

  const lockCard =
    fallback ?? (
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-panel border border-border bg-card px-6 py-6">
        <p className="text-sm font-semibold text-foreground">Follow this company to see its hiring history</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description ?? `Recent hiring changes, funding, tech stack, and news for ${displayName} — visible once you follow.`}
        </p>
        <p className="text-xs font-semibold text-muted-foreground">Followers only</p>
        {showFollowButton && (
          <CompanyFollowControl
            domain={domain}
            slug={slug}
            displayName={displayName}
            variant="primary"
            idleLabel="Follow this company to see its hiring history"
            className="items-center"
          />
        )}
      </div>
    );

  return (
    <div
      data-testid={testId}
      data-unlocked={unlocked ? "true" : "false"}
      // A locked wrapper's height otherwise comes only from its blurred
      // children — a company with little to show behind THIS gate (e.g. no
      // change events) shrinks the wrapper below the lock card's own height,
      // and the card (flex-centered, absolute, unclipped) then overflows
      // past the wrapper into whatever sits below it on the page. A floor
      // tall enough for the taller (with-button) card variant keeps the
      // overlay self-contained regardless of what's behind it.
      className={cn("relative", !unlocked && "min-h-80")}
    >
      <div
        className={cn(!unlocked && "pointer-events-none select-none")}
        aria-hidden={!unlocked}
      >
        {children}
      </div>
      {!unlocked && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background px-6 py-10 text-center">
          {lockCard}
        </div>
      )}
    </div>
  );
}
