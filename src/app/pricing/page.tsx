import type { Metadata } from "next";
import { connection } from "next/server";
import { PricingClient } from "./pricing-client";
import { PRICING_DESCRIPTION } from "./offer";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { getServerUser } from "@/lib/auth/server-user";
import { paidSummary } from "@/lib/billing/access";
import { isAutoRenewConfigured, isBillingConfigured } from "@/lib/billing/config";
import { readProfile } from "@/lib/billing/profile-store";

const TITLE = "Pricing";

export const metadata: Metadata = {
  description: PRICING_DESCRIPTION,
  ...canonicalMetadata("/pricing", TITLE, PRICING_DESCRIPTION),
};

/**
 * /pricing: one card. Server shell so the billing switch (server-only env)
 * and the signed-in account's paid-until date are resolved per request and
 * handed down as props; `PricingClient` owns the picker and the Buy call.
 */
export default async function PricingPage() {
  await connection();
  const user = await getServerUser();
  // A failed read must not 500 the page that sells the month: say so, keep buying open.
  let paidUntil: number | null = null;
  let autoRenewing = false;
  let paidStatusUnknown = false;
  if (user) {
    try {
      ({ paidUntil, autoRenewing } = paidSummary(await readProfile(user.uid)));
    } catch {
      paidStatusUnknown = true;
    }
  }
  return (
    <PricingClient
      signedIn={Boolean(user)}
      billingConfigured={isBillingConfigured()}
      autoRenewConfigured={isAutoRenewConfigured()}
      autoRenewing={autoRenewing}
      paidUntil={paidUntil}
      paidStatusUnknown={paidStatusUnknown}
    />
  );
}
