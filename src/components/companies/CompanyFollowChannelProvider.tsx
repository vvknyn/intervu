"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  useCompanyEmailVerifiedChannel,
  type CompanyEmailVerifiedChannel,
} from "@/lib/follows/use-company-email-verified";

const CompanyFollowChannelContext = createContext<CompanyEmailVerifiedChannel | null>(null);

export function CompanyFollowChannelProvider({
  domain,
  displayName,
  children,
}: {
  domain: string;
  displayName: string;
  children: ReactNode;
}) {
  const channel = useCompanyEmailVerifiedChannel(domain, displayName);
  return <CompanyFollowChannelContext.Provider value={channel}>{children}</CompanyFollowChannelContext.Provider>;
}

/** Shared follow channel when wrapped in `CompanyFollowChannelProvider`; null otherwise. */
export function useCompanyFollowChannel(): CompanyEmailVerifiedChannel | null {
  return useContext(CompanyFollowChannelContext);
}
