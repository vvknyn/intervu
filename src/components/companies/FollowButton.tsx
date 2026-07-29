"use client";

import { useEffect, useState } from "react";
import { followCompanyAction, unfollowCompanyAction } from "@/actions/follows";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/firebase/client-auth";
import { addGuestFollow, removeGuestFollow } from "@/lib/follows/guest-store";
import { invalidateFollowsCache, useFollows } from "@/lib/follows/use-follows";
import { cn } from "@/lib/utils";

export interface FollowButtonProps {
  domain: string;
  slug: string;
  displayName: string;
  variant?: "brand" | "outline";
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
    following ? (variant === "brand" ? "Following ✓" : "Following") : "Follow";

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
