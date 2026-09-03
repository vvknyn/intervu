"use client";

import { useEffect, useState } from "react";
import { followCompanyAction, unfollowCompanyAction } from "@/actions/follows";
import { recordFollowFunnelAction } from "@/actions/follow-funnel";
import { captureEvent } from "@/lib/analytics/events";
import { unfollowByContactCookieAction } from "@/actions/email-follow";
import { Button } from "@/components/ui/button";
import { FollowEmailStep } from "@/components/companies/FollowEmailStep";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Anchor as PopoverAnchor } from "@radix-ui/react-popover";
import { getCurrentUser } from "@/lib/firebase/client-auth";
import { addGuestFollow, removeGuestFollow } from "@/lib/follows/guest-store";
import { invalidateFollowsCache, useFollows } from "@/lib/follows/use-follows";
import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/** Busy-state label for follow/unfollow actions — one place for tests and UI. */
export function followButtonBusyLabel(following: boolean): string {
  return following ? "Unfollowing…" : "Following…";
}

/** Idle label once a real channel exists. "Following ✓" read as a status
 *  badge, not a control — the click already unfollowed; the copy has to
 *  say so. */
export function followButtonFollowingLabel(): string {
  return "Unfollow";
}

export type GuestFollowClickAction = { kind: "unfollow" } | { kind: "open-email-step" };

/**
 * Pure: what a signed-out click on Follow must do next. The return type has
 * no "start following locally" member — a guest can only become "following"
 * through a real channel (a verified email link or a returning
 * contact-cookie identity, both server-confirmed), never by clicking. This
 * is the fix for "how can I follow a company when I have not shared an
 * email or logged in???" — the click either reverses an already-real follow
 * or opens the channel-capture step; it never fakes the follow itself.
 */
export function decideGuestFollowClick(currentlyFollowing: boolean): GuestFollowClickAction {
  return currentlyFollowing ? { kind: "unfollow" } : { kind: "open-email-step" };
}

/**
 * Pure: does a real channel exist to render "Following" on? Signed in,
 * this reduces to exactly the pre-fix formula (`accountFollowing`,
 * unchanged) — `emailVerified` is guest-only input, so it's ignored once
 * signed in rather than letting a stale value (e.g. a leftover
 * `?followed=1`) override the account's own follow state.
 */
export function resolveFollowingState(input: {
  accountFollowing: boolean;
  isSignedIn: boolean;
  emailVerified: boolean;
}): boolean {
  return input.accountFollowing || (!input.isSignedIn && input.emailVerified);
}

export interface FollowButtonProps {
  domain: string;
  slug: string;
  displayName: string;
  /** primary = the page's single inverted-ink action; elite = ink outline, squared (company page); pill = hot-table compact */
  variant?: "primary" | "outline" | "elite" | "pill";
  className?: string;
  /**
   * A signed-out visitor who already has a real, verified notification
   * channel for this company (confirmed email link, or a returning
   * contact-cookie identity) — only then may a guest render "Following".
   * Ignored once signed in, where `byDomain` (Firestore) is authoritative.
   */
  emailVerified?: boolean;
  /**
   * Idle (not-following) label override — default "Follow". `/co`'s hero
   * wants the promise stated up front ("Follow — new roles by email"); every
   * other surface (SERP row pill, hot-table) leaves this unset so its
   * compact "Follow" is unchanged. Following/verified-state labels are a
   * separate branch below and are never affected by this.
   */
  idleLabel?: string;
  /** Fired once a guest's real (contact-cookie) follow is actually removed,
   *  so a richer wrapper tracking its own verified state (e.g.
   *  `CompanyFollowControl`) can stop showing it too. */
  onGuestUnfollow?: () => void;
  /** Passed through to the email-capture step's "sign in instead" link.
   *  Omit to hide that link (e.g. the hot-table pill has no auth popover
   *  of its own to hand off to). */
  onSignInInstead?: () => void;
}

export function FollowButton({
  domain,
  slug,
  displayName,
  variant = "outline",
  className,
  emailVerified = false,
  idleLabel = "Follow",
  onGuestUnfollow,
  onSignInInstead,
}: FollowButtonProps) {
  const normalizedDomain = domain.trim().toLowerCase();
  const { byDomain, loading, isSignedIn } = useFollows();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailStepOpen, setEmailStepOpen] = useState(false);

  const confirmedFollowing = resolveFollowingState({
    accountFollowing: byDomain.has(normalizedDomain),
    isSignedIn,
    emailVerified,
  });
  const following = optimistic ?? confirmedFollowing;

  useEffect(() => {
    setOptimistic(null);
    setBusy(false);
    setEmailStepOpen(false);
  }, [normalizedDomain]);

  useEffect(() => {
    if (optimistic !== null && optimistic === confirmedFollowing) {
      setOptimistic(null);
    }
  }, [optimistic, confirmedFollowing]);

  const handleClick = async () => {
    if (busy) return;
    const user = getCurrentUser();

    if (!user) {
      const action = decideGuestFollowClick(following);
      if (action.kind === "unfollow") {
        // A guest can only be "following" via a real, verified channel —
        // reverse that for real (contact-cookie), not just a local
        // bookmark, or unfollow would lie the other way.
        setBusy(true);
        try {
          const res = await unfollowByContactCookieAction({ companyDomain: normalizedDomain });
          if (res.status === "unfollowed") {
            // Clear any leftover intent bookmark too, or a later sign-in
            // would resurrect the follow this click just removed.
            removeGuestFollow(normalizedDomain);
            onGuestUnfollow?.();
            captureEvent("company_unfollowed", { company_domain: normalizedDomain });
          }
        } finally {
          setBusy(false);
        }
        return;
      }
      // No channel yet. Record the click (funnel entry) and the guest-store
      // intent — it may still migrate to a real account follow on sign-in
      // (syncGuestFollowsToServer) — then open the email step right here
      // instead of pretending the follow already happened.
      void recordFollowFunnelAction("follow_click", normalizedDomain);
      addGuestFollow({ domain: normalizedDomain, slug, displayName });
      setEmailStepOpen(true);
      return;
    }

    const next = !following;
    setOptimistic(next);
    setBusy(true);
    // "follow_click" is the funnel's entry event — the one-directional
    // watch-a-company ladder starts here, so only the follow direction
    // (not unfollow) is recorded.
    if (next) void recordFollowFunnelAction("follow_click", normalizedDomain);

    try {
      if (next) {
        const res = await followCompanyAction({ domain: normalizedDomain, slug, displayName });
        if (res.error) throw new Error(res.error);
        // Deliberately here and not beside the optimistic flip above.
        // `follow_click` up there is the INTENT event; this one asserts the
        // follow exists, and the optimistic state is rolled back on failure.
        // A failed action throws on the line above and never reaches this.
        captureEvent("company_followed", { company_domain: normalizedDomain });
      } else {
        const res = await unfollowCompanyAction(normalizedDomain);
        if (res.error) throw new Error(res.error);
        captureEvent("company_unfollowed", { company_domain: normalizedDomain });
      }
      invalidateFollowsCache();
    } catch {
      setOptimistic(null);
    } finally {
      setBusy(false);
    }
  };

  const label = following ? followButtonFollowingLabel() : idleLabel;
  const displayLabel = busy ? followButtonBusyLabel(following) : label;
  const disabled = busy || (loading && optimistic === null);
  const showSpinner = busy || (loading && optimistic === null);

  const buttonNode =
    variant === "elite" || variant === "pill" ? (
      <button
        type="button"
        data-testid="follow-company"
        data-following={following ? "true" : "false"}
        aria-pressed={following}
        aria-label={following ? `Unfollow ${displayName}` : undefined}
        disabled={disabled}
        aria-busy={showSpinner || undefined}
        onClick={() => void handleClick()}
        className={cn(
          "inline-flex items-center justify-center gap-2",
          variant === "elite" &&
            "border px-4 py-2 text-sm font-semibold transition-colors",
          variant === "elite" &&
            (following
              ? "border-[color:var(--elite-ink)] bg-[color:var(--elite-ink)] text-[color:var(--elite-surface)]"
              : "border-[color:var(--elite-ink)] bg-[color:var(--elite-card)] text-[color:var(--elite-ink)] hover:bg-[color:var(--elite-rule)]"),
          variant === "pill" &&
            "rounded-none border px-3 py-1.5 text-xs transition-colors",
          variant === "pill" &&
            (following
              ? "border-[color:var(--elite-tint-border)] bg-[color:var(--elite-tint-bg)] text-[color:var(--elite-brand)]"
              : "border-[color:var(--elite-border-strong)] bg-[color:var(--elite-card)] text-[color:var(--elite-ink)] hover:border-[color:var(--elite-muted)]"),
          className,
        )}
      >
        {showSpinner && <CircleNotch className="animate-spin shrink-0" aria-hidden />}
        {displayLabel}
      </button>
    ) : (
      <Button
        type="button"
        variant={variant === "primary" ? "default" : variant}
        size="sm"
        data-testid="follow-company"
        data-following={following ? "true" : "false"}
        aria-pressed={following}
        aria-label={following ? `Unfollow ${displayName}` : undefined}
        disabled={disabled}
        aria-busy={showSpinner || undefined}
        onClick={() => void handleClick()}
        className={cn(
          following &&
            variant === "outline" &&
            "border-brand bg-muted text-brand hover:bg-muted hover:text-brand",
          className,
        )}
      >
        {showSpinner && <CircleNotch className="animate-spin shrink-0" aria-hidden />}
        {displayLabel}
      </Button>
    );

  // `PopoverAnchor` (not `PopoverTrigger`) deliberately — a Trigger toggles
  // itself on every click, which would pop the email step open for signed-in
  // clicks and for a guest's unfollow click too. `handleClick` above is the
  // only thing allowed to decide when this opens.
  return (
    <Popover open={emailStepOpen} onOpenChange={setEmailStepOpen}>
      <PopoverAnchor asChild>{buttonNode}</PopoverAnchor>
      <PopoverContent align="end" className="w-[240px] p-4">
        <FollowEmailStep
          companyDomain={normalizedDomain}
          displayName={displayName}
          onSignInInstead={
            onSignInInstead
              ? () => {
                  setEmailStepOpen(false);
                  onSignInInstead();
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}
