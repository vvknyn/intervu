"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The pay-it-forward pledge link for the tracker. `/yours` is a client
 * page, and the Stripe link lives in a server-only env var
 * (LANDED_PLEDGE_CHECKOUT_URL), so the route's server layout resolves it
 * once per request and hands it down here; the detail sheet reads it with
 * `usePledgeUrl()`. Outside the provider (tests, other routes) it is null,
 * which renders the "tell us how it went" version of the panel.
 */
const PledgeContext = createContext<string | null>(null);

export function PledgeProvider({ url, children }: { url: string | null; children: ReactNode }) {
  return <PledgeContext.Provider value={url}>{children}</PledgeContext.Provider>;
}

export function usePledgeUrl(): string | null {
  return useContext(PledgeContext);
}
