"use client";

import { useEffect, useState } from "react";
import { followCompanyAction, unfollowCompanyAction } from "@/actions/follows";
import { recordFollowFunnelAction } from "@/actions/follow-funnel";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/firebase/client-auth";
import { addGuestFollow, removeGuestFollow } from "@/lib/follows/guest-store";
import { invalidateFollowsCache, useFollows } from "@/lib/follows/use-follows";
import { cn } from "@/lib/utils";

export interface FollowButtonProps {
  domain: string;
  slug: string;
  displayName: string;
  /** brand = generic; elite = ink outline, squared (company page); pill = hot-table compact */
  variant?: "brand" | "outline" | "elite" | "pill";
  className?: string;
}

export function FollowButton({
  domain,
  slug,
  displayName,
  variant = "outline",
  className,
}: FollowButtonProps) {
  const normalizedDomain = domain.trim().toLowerCase();
  const { byDomain, loading } = useFollows();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const following = optimistic ?? byDomain.has(normalizedDomain);

  useEffect(() => {
    setOptimistic(null);
    setBusy(false);
  }, [normalizedDomain]);

  useEffect(() => {
    if (optimistic !== null && optimistic === byDomain.has(normalizedDomain)) {
      setOptimistic(null);
    }
  }, [optimistic, byDomain, normalizedDomain]);

  const handleClick = async () => {
    if (busy) return;
    const next = !following;
    setOptimistic(next);
    setBusy(true);
    // "follow_click" is the funnel's entry event — the one-directional
    // watch-a-company ladder starts here, so only the follow direction
    // (not unfollow) is recorded.
    if (next) void recordFollowFunnelAction("follow_click", normalizedDomain);

    try {
      const user = getCurrentUser();
      if (!user) {
        if (next) {
          addGuestFollow({ domain: normalizedDomain, slug, displayName });
        } else {
          removeGuestFollow(normalizedDomain);
        }
        return;
      }

      if (next) {
        const res = await followCompanyAction({ domain: normalizedDomain, slug, displayName });
        if (res.error) throw new Error(res.error);
      } else {
        const res = await unfollowCompanyAction(normalizedDomain);
        if (res.error) throw new Error(res.error);
      }
      invalidateFollowsCache();
    } catch {
      setOptimistic(null);
    } finally {
      setBusy(false);
    }
  };

  const label =
    following
      ? variant === "elite" || variant === "brand"
        ? "Following ✓"
        : "Following"
      : "Follow";

  if (variant === "elite" || variant === "pill") {
    return (
      <button
        type="button"
        data-testid="follow-company"
        data-following={following ? "true" : "false"}
        aria-pressed={following}
        disabled={loading && optimistic === null}
        onClick={() => void handleClick()}
        className={cn(
          variant === "elite" &&
            "border px-4 py-2 text-[13.5px] font-semibold transition-colors",
          variant === "elite" &&
            (following
              ? "border-[color:var(--elite-ink)] bg-[color:var(--elite-ink)] text-[color:var(--elite-surface)]"
              : "border-[color:var(--elite-ink)] bg-[color:var(--elite-card)] text-[color:var(--elite-ink)] hover:bg-[color:var(--elite-rule)]"),
          variant === "pill" &&
            "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
          variant === "pill" &&
            (following
              ? "border-[color:var(--elite-tint-border)] bg-[color:var(--elite-tint-bg)] text-[color:var(--elite-brand)]"
              : "border-[color:var(--elite-border-strong)] bg-[color:var(--elite-card)] text-[color:var(--elite-ink)] hover:border-[color:var(--elite-muted)]"),
          className,
        )}
      >
        {label}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      data-testid="follow-company"
      data-following={following ? "true" : "false"}
      aria-pressed={following}
      disabled={loading && optimistic === null}
      onClick={() => void handleClick()}
      className={cn(
        following &&
          variant === "outline" &&
          "border-brand/25 bg-brand/10 text-brand hover:bg-brand/15 hover:text-brand",
        className,
      )}
    >
      {label}
    </Button>
  );
}
