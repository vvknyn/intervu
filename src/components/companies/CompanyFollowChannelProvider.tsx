"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import {
  useCompanyEmailVerifiedChannel,
  type CompanyEmailVerifiedChannel,
} from "@/lib/follows/use-company-email-verified";
import { captureEvent } from "@/lib/analytics/events";

const CompanyFollowChannelContext = createContext<CompanyEmailVerifiedChannel | null>(null);

export function CompanyFollowChannelProvider({
  domain,
  children,
}: {
  domain: string;
  children: ReactNode;
}) {
  const channel = useCompanyEmailVerifiedChannel(domain);
  // Every /co/[slug] mount wraps its page in this provider exactly once, so
  // it's the one place a company page view is guaranteed to fire from —
  // no separate effect duplicated across the page's own sections.
  useEffect(() => {
    captureEvent("company_viewed", { company_domain: domain });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);
  return <CompanyFollowChannelContext.Provider value={channel}>{children}</CompanyFollowChannelContext.Provider>;
}

/** Shared follow channel when wrapped in `CompanyFollowChannelProvider`; null otherwise. */
export function useCompanyFollowChannel(): CompanyEmailVerifiedChannel | null {
  return useContext(CompanyFollowChannelContext);
}
